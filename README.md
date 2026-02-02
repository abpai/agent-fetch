# 🕷️ CrawlPi

A minimal, high-performance web crawler optimized for Raspberry Pi and low-resource environments. Built with Fastify, Crawlee (Playwright), and SQLite.

## 🚀 Features

- **Resource Efficient:** Uses SQLite for queue management (no Redis needed).
- **Background Processing:** Trigger crawls via API and monitor progress in real-time.
- **CLI Management:** Add tasks and monitor stats directly from the terminal.
- **Elegant Dashboard:** Built-in HTML status page for easy monitoring.
- **Docker Ready:** Optimized Dockerfile with Playwright & Chromium pre-installed.

## 🛠️ Getting Started

### 1. Installation

```bash
pnpm install
npx playwright install chromium
```

### 2. Run the API Server

```bash
pnpm dev
```

- **API Documentation:** `http://localhost:3000/docs`
- **Crawler Dashboard:** `http://localhost:3000/api/crawler/dashboard`

### 3. Use the CLI

```bash
# Add URLs to the queue
pnpm cli add https://news.ycombinator.com https://google.com

# Check queue stats
pnpm cli stats

# Start the crawler locally
pnpm cli start
```

## 🐳 Docker Deployment

The system is designed to run in a single container. All state is persisted in the `./storage` volume.

```bash
docker compose up -d
```

## 🏗️ Project Structure

```text
src/
├── cli.ts            # CLI Interface
├── app.ts            # Fastify App & Middleware
├── server.ts         # API Entry Point
├── services/
│   └── crawler.service.ts  # Core Crawler Logic
└── modules/
    └── crawler/
        └── routes.ts       # API & Dashboard Routes
```

## 🧰 Optional Scrape.do Queue Worker

This repo includes a Redis-backed worker that tries a cheap local fetch first and only falls back to Scrape.do when needed.

```bash
pnpm install

export SCRAPEDO_TOKEN='YOUR_TOKEN'
export REDIS_URL='redis://127.0.0.1:6379'
export INPUT_FILE='./data/url_queue_urls.txt'
export OUT_DIR='./out'
export CONCURRENCY=10

# Fill the queue
pnpm crawler-queue enqueue

# Start workers
pnpm crawler-queue worker
```

Tuning options (env vars):

- `SCRAPEDO_RENDER_ON_BLOCK=true` to allow a render attempt for blocked pages.
- `SCRAPEDO_RENDER_UNBLOCK=true` to add a last-chance render pass with `blockResources=false` + `customWait=2000`.
- `SCRAPEDO_BLOCK_RESOURCES`, `SCRAPEDO_CUSTOM_WAIT_MS` to tune rendering.
- `SCRAPEDO_SUPER=true`, `SCRAPEDO_GEO_CODE=us` for tougher targets.
- `SCRAPEDO_CUSTOM_HEADERS=true` or `SCRAPEDO_EXTRA_HEADERS=true` and `SCRAPEDO_HEADERS_JSON='{\"User-Agent\":\"...\"}'` (extra headers auto-prefix `Sd-`).

### Docker workflow (Redis + queue worker)

```bash
# Make sure SCRAPEDO_TOKEN is set in .env

# Start Redis + worker
docker compose --profile queue up -d redis crawler-queue

# Enqueue URLs from data/url_queue_urls.txt
docker compose --profile queue run --rm crawler-enqueue
```

## 📜 API Endpoints

- `POST /api/crawler/run`: Start processing the queue (optionally add new URLs in body).
- `GET /api/crawler/stats`: Get JSON statistics.
- `GET /api/crawler/dashboard`: Visual status page.

## 🛡️ License

MIT
