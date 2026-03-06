const { HNClient } = require('./hn-client');
const { OpenAIClient } = require('./openai-client');
const { ImageScraper } = require('./image-scraper');
const { S3ClientWrapper } = require('./s3-client');
const { DBClient } = require('./db-client');
const { logger } = require('./logger');

// Environment variables validation
const requiredEnvVars = [
  'OPENAI_API_KEY',
  'DATABASE_URL',
  'AWS_REGION',
  'S3_BUCKET_NAME',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Initialize clients
const hnClient = new HNClient();
const openaiClient = new OpenAIClient(
  process.env.OPENAI_API_KEY,
  process.env.OPENAI_BASE_URL
);
const imageScraper = new ImageScraper();
const s3Client = new S3ClientWrapper(
  process.env.AWS_REGION,
  process.env.AWS_ACCESS_KEY_ID,
  process.env.AWS_SECRET_ACCESS_KEY,
  process.env.S3_BUCKET_NAME,
  process.env.S3_ENDPOINT
);
const dbClient = new DBClient(process.env.DATABASE_URL);

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

    // Summarize article with OpenAI
    const summaryResponse = await openaiClient.summarizeArticle(story.title, story.url);

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
