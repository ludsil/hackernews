import { Pool } from 'pg';
import { Article } from '@/types';

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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

let migrationRun: Promise<void> | null = null;

async function ensureMigrations(): Promise<void> {
  if (!migrationRun) {
    migrationRun = pool.query(MIGRATION_SQL).then(() => {
      console.log('Database migrations completed');
    });
  }
  return migrationRun;
}

export async function getRecentArticles(limit: number = 30): Promise<Article[]> {
  await ensureMigrations();
  const result = await pool.query<Article>(
    `SELECT * FROM articles
     ORDER BY scraped_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function getArticlesByDate(date: Date, limit: number = 100): Promise<Article[]> {
  await ensureMigrations();
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const result = await pool.query<Article>(
    `SELECT * FROM articles
     WHERE scraped_at >= $1 AND scraped_at <= $2
     ORDER BY score DESC, scraped_at DESC
     LIMIT $3`,
    [startOfDay, endOfDay, limit]
  );
  return result.rows;
}

export async function searchArticles(
  query: string,
  tags?: string[],
  limit: number = 50
): Promise<Article[]> {
  await ensureMigrations();
  let sql = `SELECT * FROM articles WHERE 1=1`;
  const params: any[] = [];
  let paramIndex = 1;

  if (query && query.trim()) {
    sql += ` AND (title ILIKE $${paramIndex} OR summary ILIKE $${paramIndex})`;
    params.push(`%${query}%`);
    paramIndex++;
  }

  if (tags && tags.length > 0) {
    sql += ` AND tags && $${paramIndex}::text[]`;
    params.push(tags);
    paramIndex++;
  }

  sql += ` ORDER BY scraped_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const result = await pool.query<Article>(sql, params);
  return result.rows;
}

export async function getAllTags(): Promise<string[]> {
  await ensureMigrations();
  const result = await pool.query<{ tag: string }>(
    `SELECT DISTINCT unnest(tags) as tag
     FROM articles
     ORDER BY tag`
  );
  return result.rows.map((row) => row.tag);
}
