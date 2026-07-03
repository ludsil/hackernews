const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { HNClient } = require('./hn-client');
const { OpenAIClient } = require('./openai-client');
const { ImageScraper } = require('./image-scraper');
const { S3ClientWrapper } = require('./s3-client');
const { DBClient } = require('./db-client');
const { logger } = require('./logger');

// --- Configuration resolution -------------------------------------------------
// Supports both a plain .env-style config (DATABASE_URL, S3_BUCKET_NAME,
// OPENAI_API_KEY) for local dev, and spawned's injected env vars in production
// (DB_* from Function->Database, S3_BUCKET from Function->Bucket, and a secret
// ARN from Function->Secret).

// Derive DATABASE_URL from spawned's Function->Database env vars if not set.
function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  if (DB_HOST && DB_USER && DB_PASSWORD && DB_NAME) {
    const port = DB_PORT || '5432';
    return `postgresql://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:${port}/${DB_NAME}`;
  }
  return undefined;
}

if (!process.env.DATABASE_URL) {
  const derived = resolveDatabaseUrl();
  if (derived) process.env.DATABASE_URL = derived;
}

// spawned's Function->Bucket injects <NAME>_BUCKET (S3_BUCKET); the app reads S3_BUCKET_NAME.
if (!process.env.S3_BUCKET_NAME && process.env.S3_BUCKET) {
  process.env.S3_BUCKET_NAME = process.env.S3_BUCKET;
}

// Fetch the OpenAI API key at runtime. spawned's Function->Secret connection
// injects only the secret's ARN (OPENAI_SECRET_ARN) — Lambda has no native
// secret-value injection, so we read it with the SDK.
async function resolveOpenAiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const arn = process.env.OPENAI_SECRET_ARN;
  if (!arn) return undefined;
  const sm = new SecretsManagerClient({ region: process.env.AWS_REGION });
  const res = await sm.send(new GetSecretValueCommand({ SecretId: arn }));
  try {
    const parsed = JSON.parse(res.SecretString || '{}');
    return parsed.api_key || parsed.OPENAI_API_KEY || undefined;
  } catch {
    // Secret stored as a raw string rather than JSON.
    return res.SecretString || undefined;
  }
}

// Environment variables validation (OPENAI_API_KEY is resolved at runtime).
const requiredEnvVars = ['DATABASE_URL', 'AWS_REGION', 'S3_BUCKET_NAME'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Initialize clients (openaiClient is created in the handler once the key resolves).
const hnClient = new HNClient();
let openaiClient = null;
const imageScraper = new ImageScraper();
const s3Client = new S3ClientWrapper(
  process.env.AWS_REGION,
  process.env.AWS_ACCESS_KEY_ID,
  process.env.AWS_SECRET_ACCESS_KEY,
  process.env.S3_BUCKET_NAME,
  process.env.S3_ENDPOINT
);
const dbClient = new DBClient(process.env.DATABASE_URL);

// Fallback summary used when no OpenAI client is available.
function fallbackSummary(story) {
  return {
    summary: `${story.title} - Visit the article for more details.`,
    tags: ['general', 'tech', 'hackernews'],
  };
}

async function processArticle(story) {
  const articleLogger = logger.child({ hn_id: story.id });

  try {
    articleLogger.info('Processing article', {
      title: story.title,
      url: story.url
    });

    // Upload raw JSON to S3
    const s3RawPath = await s3Client.uploadRawJson(story.id, story);

    // Extract and upload image (non-blocking)
    let imageUrl = null;
    if (story.url) {
      try {
        const extractedImageUrl = await imageScraper.extractImage(story.url);
        if (extractedImageUrl) {
          const imageBuffer = await imageScraper.downloadImage(extractedImageUrl);
          if (imageBuffer) {
            const s3ImagePath = await s3Client.uploadImage(story.id, imageBuffer, extractedImageUrl);
            imageUrl = s3Client.getPublicUrl(s3ImagePath);
            articleLogger.info('Image processed', { imageUrl });
          }
        }
      } catch (error) {
        articleLogger.warn('Failed to process image, continuing without it', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Summarize article with OpenAI (fall back if no key is configured)
    const summaryResponse = openaiClient
      ? await openaiClient.summarizeArticle(story.title, story.url)
      : fallbackSummary(story);

    // Upsert to database
    await dbClient.upsertArticle({
      hn_id: story.id,
      title: story.title,
      url: story.url,
      summary: summaryResponse.summary,
      tags: summaryResponse.tags,
      score: story.score,
      image_url: imageUrl,
      s3_raw_path: s3RawPath,
    });

    articleLogger.info('Article processed successfully', {
      title: story.title,
      tags: summaryResponse.tags
    });

    return true;
  } catch (error) {
    articleLogger.error('Failed to process article', {
      title: story.title,
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

async function handler(_event, _context) {
  logger.info('Starting scraper');

  // Resolve the OpenAI key at runtime (from Secrets Manager in production).
  try {
    const openAiKey = await resolveOpenAiKey();
    if (openAiKey) {
      openaiClient = new OpenAIClient(openAiKey, process.env.OPENAI_BASE_URL);
    } else {
      logger.warn('No OpenAI API key resolved; articles will be stored with fallback summaries');
    }
  } catch (error) {
    logger.warn('Failed to resolve OpenAI API key; using fallback summaries', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let scrapeRunId;
  let articlesProcessed = 0;
  let errorsCount = 0;

  try {
    // Ensure database tables exist
    await dbClient.runMigrations();

    // Start scrape run
    scrapeRunId = await dbClient.startScrapeRun();

    // Fetch top stories
    const topStoryIds = await hnClient.getTopStories(30);
    logger.info('Fetched top story IDs', { count: topStoryIds.length });

    // Fetch story details
    const stories = await hnClient.getStories(topStoryIds);
    logger.info('Fetched stories with URLs', { count: stories.length });

    // Process each article
    for (const story of stories) {
      const success = await processArticle(story);
      if (success) {
        articlesProcessed++;
      } else {
        errorsCount++;
      }
    }

    // Update scrape run status
    await dbClient.updateScrapeRun(
      scrapeRunId,
      'completed',
      articlesProcessed,
      errorsCount
    );

    logger.info('Scraper completed', {
      articlesProcessed,
      errorsCount,
      scrapeRunId
    });

    return {
      success: true,
      articlesProcessed,
      errorsCount,
      scrapeRunId,
    };
  } catch (error) {
    logger.error('Scraper failed', {
      error: error instanceof Error ? error.message : String(error)
    });

    // Update scrape run with failure
    if (scrapeRunId) {
      await dbClient.updateScrapeRun(
        scrapeRunId,
        'failed',
        articlesProcessed,
        errorsCount,
        error instanceof Error ? error.message : String(error)
      );
    }

    throw error;
  }
}

// CLI entrypoint for local development
// Env vars are loaded via -r dotenv/config in package.json scripts
if (require.main === module) {
  handler()
    .then((result) => {
      logger.info('Scraper finished', result);
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Scraper crashed', {
        error: error instanceof Error ? error.message : String(error)
      });
      process.exit(1);
    });
}

module.exports = { handler };
