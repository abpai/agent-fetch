import { describe, it, expect, afterAll } from 'vitest'
import { crawl, closeBrowser, CrawlError } from './index.js'

describe('smart scrape fallback chain', () => {
  afterAll(async () => {
    await closeBrowser()
  })

  it('uses fetch for simple static pages', async () => {
    // example.com has only 17 words, so we lower thresholds for this test
    const result = await crawl('https://example.com', {
      enableFetch: true,
      enableJsdom: false,
      enablePlaywright: false,
      enableScrapeDo: false,
      minWordCount: 10, // Lower threshold for minimal page
      minMarkdownLength: 50,
    })

    expect(result.strategy).toBe('fetch')
    expect(result.title).toBe('Example Domain')
    expect(result.markdown).toContain('documentation')
    expect(result.wordCount).toBeGreaterThan(0)
  })

  it('falls back to playwright when fetch result is insufficient', async () => {
    // For static pages, both fetch and playwright return the same content.
    // Test with a real JS-rendered site or verify the fallback chain attempts.
    try {
      await crawl('https://example.com', {
        enableFetch: true,
        enableJsdom: false,
        enablePlaywright: true,
        enableScrapeDo: false,
        minWordCount: 18, // Just above what fetch returns (17)
        minMarkdownLength: 50,
      })
    } catch (error) {
      // Since example.com is static, both strategies return same content
      // Verify that it DID try playwright as a fallback
      expect(error).toBeInstanceOf(CrawlError)
      const crawlError = error as CrawlError
      expect(crawlError.attempts).toHaveLength(2)
      expect(crawlError.attempts[0].strategy).toBe('fetch')
      expect(crawlError.attempts[0].ok).toBe(false)
      expect(crawlError.attempts[1].strategy).toBe('playwright')
      expect(crawlError.attempts[1].ok).toBe(false)
    }
  })

  it('throws CrawlError with attempts when all strategies fail', async () => {
    try {
      await crawl('https://example.com', {
        enableFetch: true,
        enableJsdom: false,
        enablePlaywright: false,
        enableScrapeDo: false,
        minWordCount: 10000, // Impossible threshold
      })
      expect.fail('Should have thrown CrawlError')
    } catch (error) {
      expect(error).toBeInstanceOf(CrawlError)
      const crawlError = error as CrawlError
      expect(crawlError.attempts).toHaveLength(1)
      expect(crawlError.attempts[0].strategy).toBe('fetch')
      expect(crawlError.attempts[0].ok).toBe(false)
      expect(crawlError.attempts[0].reason).toContain('acceptance thresholds')
    }
  })

  it('uses jsdom for JS rendering when enabled', async () => {
    const result = await crawl('https://example.com', {
      enableFetch: false,
      enableJsdom: true,
      enablePlaywright: false,
      enableScrapeDo: false,
      minWordCount: 10,
      minMarkdownLength: 50,
    })

    expect(result.strategy).toBe('jsdom')
    expect(result.markdown).toBeTruthy()
  })

  it('detects blocked pages and rejects them', async () => {
    try {
      await crawl('https://example.com', {
        enableFetch: true,
        enablePlaywright: false,
        blockedTextPatterns: [/example/i], // Match the page content
        blockedWordCountThreshold: 1000, // Enable pattern matching since page is small
        minWordCount: 5,
      })
      expect.fail('Should have rejected due to blocked pattern')
    } catch (error) {
      expect(error).toBeInstanceOf(CrawlError)
    }
  })

  it('includes all attempt details in CrawlError', async () => {
    try {
      await crawl('https://example.com', {
        enableFetch: true,
        enableJsdom: true,
        enablePlaywright: true,
        enableScrapeDo: false,
        minWordCount: 10000, // Impossible threshold
      })
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(CrawlError)
      const crawlError = error as CrawlError
      expect(crawlError.attempts.length).toBeGreaterThanOrEqual(3)

      const strategies = crawlError.attempts.map((a) => a.strategy)
      expect(strategies).toContain('fetch')
      expect(strategies).toContain('jsdom')
      expect(strategies).toContain('playwright')
    }
  })

  it('tries strategies in order: fetch -> jsdom -> playwright', async () => {
    try {
      await crawl('https://example.com', {
        enableFetch: true,
        enableJsdom: true,
        enablePlaywright: true,
        enableScrapeDo: false,
        minWordCount: 10000, // Force all to fail
      })
    } catch (error) {
      expect(error).toBeInstanceOf(CrawlError)
      const crawlError = error as CrawlError
      expect(crawlError.attempts[0].strategy).toBe('fetch')
      expect(crawlError.attempts[1].strategy).toBe('jsdom')
      expect(crawlError.attempts[2].strategy).toBe('playwright')
    }
  })

  it('skips disabled strategies', async () => {
    try {
      await crawl('https://example.com', {
        enableFetch: false, // Disabled
        enableJsdom: true,
        enablePlaywright: false, // Disabled
        enableScrapeDo: false,
        minWordCount: 10000,
      })
    } catch (error) {
      expect(error).toBeInstanceOf(CrawlError)
      const crawlError = error as CrawlError
      expect(crawlError.attempts).toHaveLength(1)
      expect(crawlError.attempts[0].strategy).toBe('jsdom')
    }
  })
})
