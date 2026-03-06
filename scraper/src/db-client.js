const { Pool } = require('pg');
const { logger } = require('./logger');

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS articles (
    id SERIAL PRIMARY KEY,
    hn_id INTEGER UNIQUE NOT NULL,
    title TEXT NOT NULL,
    url TEXT UNIQUE NOT NULL,
    summary TEXT,
    tags TEXT[],
    score INTEGER NOT NULL DEFAULT 0,
    image_url TEXT,
    s3_raw_path TEXT,
    scraped_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scrape_runs (
    id SERIAL PRIMARY KEY,
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    articles_processed INTEGER DEFAULT 0,
    errors_count INTEGER DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_articles_scraped_at ON articles(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_hn_id ON articles(hn_id);
CREATE INDEX IF NOT EXISTS idx_articles_tags ON articles USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_started_at ON scrape_runs(started_at DESC);

CREATE OR REPLACE FUNCTION update_scraped_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.scraped_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_scraped_at ON articles;
CREATE TRIGGER trigger_update_scraped_at
    BEFORE UPDATE ON articles
    FOR EACH ROW
    EXECUTE FUNCTION update_scraped_at();
`;

class DBClient {
  constructor(connectionString) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    logger.info('Database client initialized');
  }

  async runMigrations() {
    try {
      logger.info('Running database migrations');
      await this.pool.query(MIGRATION_SQL);
      logger.info('Database migrations completed');
    } catch (error) {
      logger.error('Database migrations failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async startScrapeRun() {
    try {
      logger.info('Starting scrape run');

      const result = await this.pool.query(
        `INSERT INTO scrape_runs (started_at, status, articles_processed, errors_count)
         VALUES (NOW(), 'running', 0, 0)
         RETURNING id`
      );

      const runId = result.rows[0].id;
      logger.info('Scrape run started', { runId });
      return runId;
    } catch (error) {
      logger.error('Failed to start scrape run', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async updateScrapeRun(runId, status, articlesProcessed, errorsCount, errorMessage) {
    try {
      logger.debug('Updating scrape run', {
        runId,
        status,
        articlesProcessed,
        errorsCount
      });

      await this.pool.query(
        `UPDATE scrape_runs
         SET completed_at = NOW(),
             status = $1,
             articles_processed = $2,
             errors_count = $3,
             error_message = $4
         WHERE id = $5`,
        [status, articlesProcessed, errorsCount, errorMessage, runId]
      );

      logger.info('Scrape run updated', {
        runId,
        status,
        articlesProcessed,
        errorsCount
      });
    } catch (error) {
      logger.error('Failed to update scrape run', {
        runId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async upsertArticle(article) {
    try {
      logger.debug('Upserting article', {
        hn_id: article.hn_id,
        title: article.title
      });

      await this.pool.query(
        `INSERT INTO articles (
           hn_id, title, url, summary, tags, score, image_url, s3_raw_path, scraped_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (url)
         DO UPDATE SET
           title = EXCLUDED.title,
           summary = EXCLUDED.summary,
           tags = EXCLUDED.tags,
           score = EXCLUDED.score,
           image_url = COALESCE(EXCLUDED.image_url, articles.image_url),
           s3_raw_path = EXCLUDED.s3_raw_path,
           scraped_at = NOW()`,
        [
          article.hn_id,
          article.title,
          article.url,
          article.summary,
          article.tags,
          article.score,
          article.image_url,
          article.s3_raw_path,
        ]
      );

      logger.debug('Article upserted', { hn_id: article.hn_id });
    } catch (error) {
      logger.error('Failed to upsert article', {
        hn_id: article.hn_id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async close() {
    await this.pool.end();
    logger.info('Database connection closed');
  }
}

module.exports = { DBClient };
