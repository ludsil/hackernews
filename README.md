# AI Hacker News Digest

A full-stack application that scrapes top stories from Hacker News, summarizes them using OpenAI, and displays them in a beautiful web interface.

## Features

- Automated scraping of Hacker News top stories
- AI-powered article summaries using OpenAI
- Image extraction from articles
- PostgreSQL database for storing articles
- Next.js frontend with Shadcn/ui components
- Local development with Docker Compose (PostgreSQL + MinIO)
- Lambda-ready scraper for production deployment

## Project Structure

```
ai_hackernews/
├── scraper/        # Lambda function for scraping and processing
├── web/            # Next.js frontend application
└── docker/         # Docker Compose setup for local development
```

## Prerequisites

- Node.js 18+ and npm
- Docker and Docker Compose
- OpenAI API key

## Setup Instructions

### 1. Clone and Install Dependencies

```bash
cd ai_hackernews
npm install
```

This will install dependencies for all packages (scraper and web).

### 2. Set Up Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` and add your OpenAI API key:

```
OPENAI_API_KEY=sk-your-actual-openai-key-here
```

The default values for local development should work for everything else.

### 3. Start Local Services

Start PostgreSQL and MinIO using Docker Compose:

```bash
npm run docker:up
```

This will:
- Start PostgreSQL on port 5432
- Start MinIO (S3-compatible storage) on port 9000
- Start MinIO Console on port 9001
- Automatically create the database schema
- Create the S3 bucket

You can access:
- PostgreSQL: `postgresql://hnuser:hnpassword@localhost:5432/hn_digest`
- MinIO Console: http://localhost:9001 (login: minioadmin/minioadmin)

### 4. Build the Scraper

```bash
cd scraper
npm run build
cd ..
```

### 5. Run the Scraper

Run the scraper to fetch and process articles:

```bash
npm run scrape
```

This will:
- Fetch the top 30 stories from Hacker News
- Download images from articles
- Generate AI summaries using OpenAI
- Store everything in PostgreSQL
- Upload raw data and images to MinIO

The scraper is idempotent - running it multiple times will update existing articles without creating duplicates.

### 6. Start the Web Application

In a new terminal:

```bash
npm run dev
```

Visit http://localhost:3000 to see your articles!

## Usage

### Running the Scraper Periodically

You can run the scraper manually whenever you want fresh articles:

```bash
npm run scrape
```

For production, deploy the scraper as a Lambda function triggered by EventBridge on a schedule (e.g., every 2 hours).

### Viewing the MinIO Console

To inspect uploaded files:

1. Visit http://localhost:9001
2. Login with: minioadmin / minioadmin
3. Browse the `hn-digest` bucket

### Accessing the Database

Connect to PostgreSQL:

```bash
psql postgresql://hnuser:hnpassword@localhost:5432/hn_digest
```

Useful queries:

```sql
-- View all articles
SELECT id, title, score, scraped_at FROM articles ORDER BY scraped_at DESC LIMIT 10;

-- View scrape runs
SELECT * FROM scrape_runs ORDER BY started_at DESC;

-- Search by tag
SELECT title, tags FROM articles WHERE 'rust' = ANY(tags);
```

## Development

### Project Scripts

From the root directory:

- `npm run scrape` - Run the scraper
- `npm run dev` - Start the Next.js development server
- `npm run build` - Build all packages
- `npm run docker:up` - Start Docker services
- `npm run docker:down` - Stop Docker services

### Workspace Scripts

**Scraper:**
```bash
cd scraper
npm run build    # Compile TypeScript
npm run scrape   # Run the scraper
npm run dev      # Run with hot reload
```

**Web:**
```bash
cd web
npm run dev      # Start development server
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Architecture

### Scraper Flow

1. Fetch top story IDs from Hacker News API
2. Fetch details for each story
3. For each article:
   - Upload raw JSON to S3 (`/raw/YYYY-MM-DD/`)
   - Extract first image from article
   - Download and upload image to S3 (`/images/{hn_id}/`)
   - Generate summary and tags using OpenAI
   - Upsert article to PostgreSQL

### Database Schema

**articles table:**
- `id` - Primary key
- `hn_id` - Hacker News story ID
- `title` - Article title
- `url` - Article URL (unique)
- `summary` - AI-generated summary
- `tags` - Array of tags
- `score` - HN score
- `image_url` - URL to stored image
- `s3_raw_path` - Path to raw JSON in S3
- `scraped_at` - When article was last scraped
- `created_at` - When article was first added

**scrape_runs table:**
- Audit log of scraper executions
- Tracks success/failure statistics

## Production Deployment

### AWS Lambda (Scraper)

1. Build the scraper: `cd scraper && npm run build`
2. Package as zip or container
3. Deploy to Lambda with environment variables
4. Set up EventBridge rule for scheduled execution
5. Create RDS PostgreSQL instance
6. Create S3 bucket for storage

### Next.js (Web)

1. Build the web app: `cd web && npm run build`
2. Deploy to Vercel, AWS ECS, or any Node.js hosting
3. Set environment variables
4. Point DATABASE_URL to your production database

### Environment Variables for Production

Update these in your production environment:

- `OPENAI_API_KEY` - Your OpenAI API key
- `DATABASE_URL` - Production PostgreSQL connection string
- `AWS_REGION` - Your AWS region
- `AWS_ACCESS_KEY_ID` - AWS credentials
- `AWS_SECRET_ACCESS_KEY` - AWS credentials
- `S3_BUCKET_NAME` - Your S3 bucket name
- Remove `S3_ENDPOINT` (use real AWS S3)

## Troubleshooting

### Scraper Issues

**"Failed to fetch top stories"**
- Check your internet connection
- Hacker News API might be down (rare)

**"Failed to summarize article"**
- Check your OpenAI API key
- Ensure you have API credits

**"Failed to upload to S3"**
- Ensure MinIO is running: `docker ps`
- Check MinIO logs: `docker logs hn-minio`

### Database Issues

**"Connection refused"**
- Ensure PostgreSQL container is running: `docker ps`
- Check connection string in `.env`

**"Table does not exist"**
- Restart containers: `npm run docker:down && npm run docker:up`
- The init.sql script should run automatically

### Web Application Issues

**"No articles found"**
- Run the scraper first: `npm run scrape`
- Check database: `psql postgresql://hnuser:hnpassword@localhost:5432/hn_digest`

**Images not loading**
- Check MinIO is running and accessible
- Verify image URLs in database

## License

MIT
