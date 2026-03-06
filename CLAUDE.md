# AI Hacker News Digest

## Project Overview

Full-stack application that scrapes Hacker News top stories, summarizes them with OpenAI GPT-5, and displays them via a Next.js web UI. Deployed on AWS.

## Architecture

- **Scraper** (`scraper/`): Node.js Lambda function triggered by EventBridge on a schedule. Fetches HN stories, extracts images, generates AI summaries, stores results in PostgreSQL and S3.
- **Web** (`web/`): Next.js 16 app running on ECS Fargate behind an ALB. Server-renders articles from PostgreSQL.
- **Database**: AWS RDS PostgreSQL. Both scraper and web connect via `DATABASE_URL` connection string.
- **Storage**: AWS S3 for raw article JSON and images. Accessed via IAM roles (no access keys).

## AWS Authentication

- **S3**: IAM role-based auth. The scraper Lambda execution role and ECS task role are granted S3 permissions. The AWS SDK default credential chain handles this automatically — no `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` needed.
- **Database**: Connection URL-based auth via `DATABASE_URL` environment variable. Not IAM-authenticated.
- **Secrets** (OpenAI API key, DATABASE_URL): Stored in AWS Secrets Manager or SSM Parameter Store and injected as environment variables into Lambda/ECS.

## Environment Variables

| Variable | Used By | Description |
|---|---|---|
| `OPENAI_API_KEY` | scraper | OpenAI API key for summarization |
| `DATABASE_URL` | scraper, web | PostgreSQL connection string |
| `AWS_REGION` | scraper | AWS region for S3 |
| `S3_BUCKET_NAME` | scraper | S3 bucket for raw data and images |
| `NEXT_PUBLIC_APP_URL` | web | Public URL of the web app |
| `NODE_ENV` | web | Set to `production` to enable SSL for DB connections |

`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `S3_ENDPOINT` are **not used** in production. IAM roles provide S3 credentials automatically.

## Key Files

- `scraper/src/index.js` — Lambda handler entry point (`handler` export)
- `scraper/src/s3-client.js` — S3 client; uses IAM roles when no explicit credentials are provided
- `scraper/src/db-client.js` — PostgreSQL client with migrations
- `web/src/lib/db.ts` — Web app database queries
- `web/src/app/page.tsx` — Home page (server-rendered article list)
- `docker/docker-compose.yml` — Local dev services (PostgreSQL + MinIO)
- `docker/init.sql` — Database schema initialization

## Deployment

### Scraper (Lambda)

The scraper runs as an AWS Lambda function with the Node.js 20 runtime.

1. Package `scraper/src/` and `scraper/node_modules/` into a zip
2. Deploy as Lambda with handler `src/index.handler`
3. Configure environment variables (OPENAI_API_KEY, DATABASE_URL, AWS_REGION, S3_BUCKET_NAME)
4. Attach an IAM execution role with S3 PutObject permission on the target bucket
5. Create an EventBridge rule to trigger on a schedule (e.g. every 2 hours)
6. Ensure the Lambda has network access to RDS (VPC configuration)

### Web (ECS Fargate)

The web app uses Next.js standalone output mode and runs on ECS Fargate.

1. Build the app: `cd web && npm run build`
2. The standalone output in `web/.next/standalone/` contains everything needed to run
3. Create a container image from the standalone build, push to ECR
4. Create an ECS service with a Fargate task definition
5. Configure environment variables (DATABASE_URL, NEXT_PUBLIC_APP_URL, NODE_ENV=production)
6. Place behind an ALB for HTTPS termination
7. Ensure the task has network access to RDS (same VPC / security group)

### Required AWS Resources

- **RDS PostgreSQL** instance (schema auto-migrates on first run)
- **S3 bucket** for article data and images
- **ECR repository** for the web container image
- **ECS cluster + Fargate service** for the web app
- **ALB** in front of ECS for HTTP/HTTPS
- **Lambda function** for the scraper
- **EventBridge rule** for scraper scheduling
- **IAM roles**: Lambda execution role (S3, CloudWatch Logs, VPC), ECS task role (none needed unless S3 access added later), ECS task execution role (ECR pull, CloudWatch Logs, Secrets Manager)
- **VPC** with private subnets for RDS/Lambda/ECS, public subnets for ALB
- **Security groups** allowing ECS→RDS and Lambda→RDS on port 5432

## Commands

```bash
# Install all dependencies (npm workspaces)
npm install

# Run scraper locally (requires .env with all vars set)
cd scraper && npm run scrape

# Run web dev server locally
cd web && npm run dev

# Build web for production
cd web && npm run build

# Start local dev services (PostgreSQL + MinIO)
npm run docker:up

# Stop local dev services
npm run docker:down
```

## Database

PostgreSQL 15. Schema is defined in `docker/init.sql` and also embedded in both `scraper/src/db-client.js` and `web/src/lib/db.ts` as auto-migrations. Tables:

- `articles` — scraped articles with AI summaries, tags, scores, image URLs
- `scrape_runs` — audit log of scraper executions

The web app's `db.ts` runs migrations on first query. The scraper's `db-client.js` runs migrations via `runMigrations()` at startup.

## Tech Stack

- Node.js 20 (scraper), Next.js 16 / React 19 / TypeScript (web)
- PostgreSQL 15 (RDS), AWS S3, OpenAI GPT-5
- Tailwind CSS 4, Shadcn/ui components
- npm workspaces for monorepo management
