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
