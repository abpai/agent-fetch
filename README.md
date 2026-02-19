# crawl

A small scraping package that extracts clean markdown from URLs with a smart fallback chain.

## Installation

```bash
pnpm add crawl
```

Note: Playwright requires browser binaries. Install them with:

```bash
pnpm exec playwright install chromium
```

## Usage

```typescript
import { crawl, closeBrowser } from 'crawl'

const result = await crawl('https://example.com')

console.log(result.title)    // Page title
console.log(result.markdown) // Clean markdown content
console.log(result.html)     // Raw HTML
console.log(result.author)   // Author if detected
console.log(result.wordCount)
console.log(result.strategy) // fetch | jsdom | playwright | scrapeDo

// When done with all crawling:
await closeBrowser()
```

## Options

```typescript
await crawl(url, {
  timeout: 30000,           // Page load timeout (default: 30s)
  waitForNetworkIdle: true, // Wait for network idle (default: true)
  enableFetch: true,        // Try fetch first (default: true)
  enableJsdom: false,       // jsdom JS render step (default: false)
  enablePlaywright: true,   // Playwright fallback (default: true)
  enableScrapeDo: false,    // Scrape.do fallback (default: false unless token provided)
  scrapeDo: {
    token: process.env.SCRAPEDO_TOKEN!,
    endpoint: 'https://api.scrape.do',
    params: { render: 'true' },
  },
  minMarkdownLength: 100,   // Acceptance thresholds
  minWordCount: 20,
})
```

## How It Works

Order of attempts:

1) `fetch()` with realistic headers
2) jsdom render (optional)
3) Playwright (optional)
4) Scrape.do (optional)

If an attempt does not meet acceptance thresholds (length/word count or blocked-page heuristics), it falls back to the next strategy. If all attempts fail, `crawl()` throws a `CrawlError` with per-strategy details.

## URL Queue CLI

Build a prioritized queue from browser history JSON files:

```bash
pnpm run queue:generate
```

Input files are read from `data/`:

- `*.json` browser history exports (required)
- `blacklist_domains.txt` domain suffixes to block (optional)
- `url_filters.json` custom filter overrides (optional)

The generator writes `data/url_queue.json`.

Manage that queue from the command line:

```bash
pnpm run queue:stats
pnpm run queue:list
pnpm run queue:peek -- 5
pnpm run queue:pop -- 10
node scripts/queue-cli.mjs enqueue https://example.com/article "Manual add"
node scripts/queue-cli.mjs remove https://example.com/article
```

See `ARCHITECTURE.md` for flow details.

## Codex App Server Mode (R2 Artifacts)

Run `codex app-server` on the crawl host (for example, Raspberry Pi), then use shell commands to crawl and upload raw content to Cloudflare R2.

Default goal: return artifact metadata, not full page bodies, unless explicitly requested.

### Recommended Instruction Split

- `AGENTS.md`: policy and defaults for this repo/session.
- `SKILL.md`: operational command workflow for crawl jobs.
- App server developer instructions: short, global behavior only.

Use `AGENTS.md` for behavior policy. Keep exact command steps in `SKILL.md`.

### Cloudflare R2 Notes

- You do not need a long-running Cloudflare CLI process.
- `wrangler` is optional for setup/admin tasks.
- Runtime uploads can use S3-compatible APIs (`aws s3 cp`, SDKs, or a small script).

Suggested env vars on the crawl host:

- `R2_ACCOUNT_ID`
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

### Example `AGENTS.md` Instructions (App Server Mode)

```md
## Crawl Artifact Policy (App Server Mode)

When a user asks to crawl a URL, run the crawl locally via shell on this host.

Default output mode is `artifact`:
1. Save raw content to a temp file.
2. Compute `sha256` and byte size.
3. Upload raw file to Cloudflare R2.
4. Return metadata only:
   - `artifact_id`
   - `bucket`
   - `key`
   - `bytes`
   - `sha256`
   - `expires_at`
   - `signed_url` (or retrieval command)

Only inline full raw content when the prompt explicitly asks for `raw-inline`.

If prompt asks for `raw`, return artifact metadata plus retrieval info.
If prompt asks for `summary` or `extract`, operate from crawled content, keep response concise, and include artifact metadata for traceability.

Never store credentials in repo files. Read R2 credentials from environment variables.
```

### Example Runtime Upload Command

```bash
aws s3 cp /tmp/crawl/$ARTIFACT_ID.html s3://$R2_BUCKET/crawl/$ARTIFACT_ID.html \
  --endpoint-url https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com
```

Configure lifecycle rules on the bucket to auto-expire objects after your desired TTL.

## Use in a Queue Worker

```typescript
import { crawl, closeBrowser } from 'crawl'

async function processJob(url: string) {
  const result = await crawl(url)
  // Store result in your database
  return result
}

// Clean up on shutdown
process.on('SIGTERM', async () => {
  await closeBrowser()
  process.exit(0)
})
```

## License

MIT
