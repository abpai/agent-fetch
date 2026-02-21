---
name: crawl-library
description: Use the crawl library to extract clean markdown from URLs. Call `crawl(url)` to get a CrawlResult with markdown, title, and metadata. Call `closeBrowser()` on shutdown to release Playwright resources.
---

# Crawl Library

Use this workflow when a worker or pipeline needs to extract content from a URL.

## Basic Usage

```typescript
import { crawl, closeBrowser } from 'crawl'

const result = await crawl('https://example.com')
// result.markdown  — clean extracted content
// result.title     — page title
// result.strategy  — which method succeeded (fetch | jsdom | playwright | scrapeDo)
// result.wordCount — word count of extracted markdown

await closeBrowser() // call once on process shutdown
```

## Worker Integration

```typescript
async function processJob(url: string) {
  const result = await crawl(url)
  return result
}

process.on('SIGTERM', async () => {
  await closeBrowser()
  process.exit(0)
})
```

## Guardrails

- Always call `closeBrowser()` on shutdown to release Playwright resources.
- The fallback chain (fetch -> jsdom -> playwright -> scrapeDo) runs automatically; do not reorder strategies.
- Check `result.strategy` to understand which method succeeded.
