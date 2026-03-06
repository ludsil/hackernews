# Quick Start Guide

## Prerequisites

1. Node.js 18+ installed
2. Docker Desktop running (for PostgreSQL and MinIO)
3. OpenAI API key

## Step-by-Step Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Build Scraper

```bash
cd scraper
npm run build
cd ..
```

### 3. Configure Environment

Edit the `.env` file in the root directory and add your OpenAI API key:

```
OPENAI_API_KEY=sk-your-actual-key-here
```

### 4. Start Docker Services

Make sure Docker Desktop is running, then:

```bash
npm run docker:up
```

Wait for services to start (about 30 seconds). Verify they're running:

```bash
docker ps
```

You should see:
- `hn-postgres` (PostgreSQL)
- `hn-minio` (MinIO S3)

### 5. Run the Scraper

```bash
npm run scrape
```

This will fetch and process 30 articles from Hacker News. You'll see logs like:

```
{"timestamp":"...","level":"info","message":"Starting scraper","service":"hn-scraper"}
{"timestamp":"...","level":"info","message":"Fetched top stories","count":30}
...
```

The first run will take 5-10 minutes depending on OpenAI API response times.

### 6. Start the Web App

```bash
npm run dev
```

Open http://localhost:3000 in your browser to see your articles!

## Troubleshooting

### "Docker daemon not running"

Start Docker Desktop application before running `npm run docker:up`.

### "Failed to summarize article" / OpenAI errors

Make sure you've set a valid OpenAI API key in `.env`.

### "Connection refused" database errors

Wait a bit longer for PostgreSQL to start, then try again. Check if it's running:

```bash
docker logs hn-postgres
```

### No articles showing on the web app

Run the scraper first: `npm run scrape`

## What's Next?

- Re-run the scraper anytime: `npm run scrape`
- View MinIO console: http://localhost:9001 (minioadmin/minioadmin)
- Connect to database: `psql postgresql://hnuser:hnpassword@localhost:5432/hn_digest`
- Stop services: `npm run docker:down`

## Production Deployment

See the main README.md for AWS deployment instructions.
