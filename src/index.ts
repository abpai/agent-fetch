import { Readability } from '@mozilla/readability'
import { JSDOM, VirtualConsole } from 'jsdom'
import { chromium } from 'playwright'
import type { Browser, BrowserContext } from 'playwright'
import TurndownService from 'turndown'

export type CrawlStrategy = 'fetch' | 'jsdom' | 'playwright' | 'scrapeDo'

export interface CrawlResult {
  url: string
  title: string
  author: string | null
  markdown: string
  html: string
  wordCount: number
  fetchedAt: Date
  strategy: CrawlStrategy
}

export interface ScrapeDoOptions {
  token: string
  endpoint?: string
  params?: Record<string, string | number | boolean>
  headers?: Record<string, string>
}

export interface CrawlOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Wait for network idle before extracting (default: true) */
  waitForNetworkIdle?: boolean
  /** Override the default User-Agent */
  userAgent?: string
  /** Extra headers for fetch/playwright/scrape.do */
  headers?: Record<string, string>
  /** Enable the fetch-first attempt (default: true) */
  enableFetch?: boolean
  /** Enable jsdom JavaScript rendering attempt (default: false) */
  enableJsdom?: boolean
  /** Enable Playwright fallback (default: true) */
  enablePlaywright?: boolean
  /** Enable Scrape.do fallback (default: false unless token provided) */
  enableScrapeDo?: boolean
  /** Fetch timeout override (defaults to timeout) */
  fetchTimeout?: number
  /** jsdom render timeout override (defaults to timeout) */
  jsdomTimeout?: number
  /** Playwright timeout override (defaults to timeout) */
  playwrightTimeout?: number
  /** Minimum HTML length for an attempt to be accepted */
  minHtmlLength?: number
  /** Minimum markdown length for an attempt to be accepted */
  minMarkdownLength?: number
  /** Minimum word count for an attempt to be accepted */
  minWordCount?: number
  /** Block obvious bot-check pages when word count is low */
  blockedTextPatterns?: Array<string | RegExp>
  /** Word count threshold for blocked-text patterns */
  blockedWordCountThreshold?: number
  /** Abort images/fonts/styles for Playwright */
  blockResources?: boolean
  /** Scrape.do configuration */
  scrapeDo?: ScrapeDoOptions
}

export interface CrawlAttempt {
  strategy: CrawlStrategy
  ok: boolean
  reason?: string
  error?: string
}

export class CrawlError extends Error {
  attempts: CrawlAttempt[]

  constructor(message: string, attempts: CrawlAttempt[]) {
    super(message)
    this.name = 'CrawlError'
    this.attempts = attempts
  }
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MIN_HTML_LENGTH = 200
const DEFAULT_MIN_MARKDOWN_LENGTH = 100
const DEFAULT_MIN_WORD_COUNT = 20
const DEFAULT_BLOCKED_WORD_COUNT_THRESHOLD = 200

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
}

const DEFAULT_BLOCKED_PATTERNS: RegExp[] = [
  /attention required/i,
  /access denied/i,
  /are you human/i,
  /captcha/i,
  /cloudflare/i,
  /robot check/i,
  /verify you are/i,
]

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
})

let browser: Browser | null = null
let context: BrowserContext | null = null
let contextInit: Promise<BrowserContext> | null = null

const buildHeaders = (options: CrawlOptions, overrides?: Record<string, string>): Record<string, string> => {
  const headers: Record<string, string> = {
    ...DEFAULT_HEADERS,
    ...options.headers,
    ...overrides,
  }

  const userAgent = options.userAgent || headers['User-Agent'] || headers['user-agent']
  if (userAgent) {
    headers['User-Agent'] = userAgent
    delete headers['user-agent']
  } else {
    headers['User-Agent'] = DEFAULT_USER_AGENT
  }

  return headers
}

const splitUserAgentHeader = (
  headers: Record<string, string>
): { userAgent: string; extraHeaders: Record<string, string> } => {
  let userAgent = DEFAULT_USER_AGENT
  const extraHeaders: Record<string, string> = {}

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'user-agent') {
      userAgent = value
    } else {
      extraHeaders[key] = value
    }
  }

  return { userAgent, extraHeaders }
}

const createTimeoutSignal = (timeoutMs: number) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs)

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  }
}

const normalizePatterns = (patterns: Array<string | RegExp> | undefined): RegExp[] => {
  if (patterns === undefined) {
    return DEFAULT_BLOCKED_PATTERNS
  }

  if (patterns.length === 0) {
    return []
  }

  return patterns.map((pattern) => (typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern))
}

const isLikelyBlocked = (result: CrawlResult, options: CrawlOptions): boolean => {
  const threshold = options.blockedWordCountThreshold ?? DEFAULT_BLOCKED_WORD_COUNT_THRESHOLD
  if (result.wordCount >= threshold) {
    return false
  }

  const patterns = normalizePatterns(options.blockedTextPatterns)
  const haystack = `${result.title}\n${result.markdown}`.toLowerCase()

  return patterns.some((pattern) => pattern.test(haystack))
}

const isResultAcceptable = (result: CrawlResult, options: CrawlOptions): boolean => {
  const minHtmlLength = options.minHtmlLength ?? DEFAULT_MIN_HTML_LENGTH
  const minMarkdownLength = options.minMarkdownLength ?? DEFAULT_MIN_MARKDOWN_LENGTH
  const minWordCount = options.minWordCount ?? DEFAULT_MIN_WORD_COUNT

  if (result.html.trim().length < minHtmlLength) {
    return false
  }
  if (result.markdown.trim().length < minMarkdownLength) {
    return false
  }
  if (result.wordCount < minWordCount) {
    return false
  }
  if (isLikelyBlocked(result, options)) {
    return false
  }

  return true
}

const countWords = (markdown: string): number => markdown.split(/\s+/).filter(Boolean).length

const extractFromHtml = (url: string, html: string, strategy: CrawlStrategy): CrawlResult => {
  let title = ''
  let author: string | null = null
  let markdown = ''

  try {
    const dom = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    title = article?.title || dom.window.document.title || ''
    author = article?.byline || null
    markdown = article?.content ? turndown.turndown(article.content) : turndown.turndown(html)
    dom.window.close()
  } catch {
    markdown = turndown.turndown(html)
  }

  return {
    url,
    title,
    author,
    markdown,
    html,
    wordCount: countWords(markdown),
    fetchedAt: new Date(),
    strategy,
  }
}

const fetchHtml = async (url: string, options: CrawlOptions, headers: Record<string, string>) => {
  const timeoutMs = options.fetchTimeout ?? options.timeout ?? DEFAULT_TIMEOUT_MS
  const { signal, clear } = createTimeoutSignal(timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const contentType = response.headers.get('content-type') || ''
    if (contentType && !contentType.includes('text/html')) {
      throw new Error(`Unexpected content-type: ${contentType}`)
    }

    const html = await response.text()

    return { html, contentType }
  } finally {
    clear()
  }
}

const renderWithJsdom = async (url: string, html: string, options: CrawlOptions) => {
  const timeoutMs = options.jsdomTimeout ?? options.timeout ?? DEFAULT_TIMEOUT_MS
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('error', () => undefined)

  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    userAgent: options.userAgent || DEFAULT_USER_AGENT,
    virtualConsole,
  })

  const waitForLoad = () =>
    new Promise<void>((resolve) => {
      if (dom.window.document.readyState === 'complete') {
        resolve()
        return
      }

      const timeout = setTimeout(resolve, timeoutMs)
      dom.window.addEventListener(
        'load',
        () => {
          clearTimeout(timeout)
          resolve()
        },
        { once: true }
      )
    })

  await waitForLoad()
  const renderedHtml = dom.serialize()
  dom.window.close()

  return renderedHtml
}

async function getBrowser(headers: Record<string, string>): Promise<BrowserContext> {
  if (browser && !browser.isConnected()) {
    browser = null
    context = null
  }

  if (browser && context) {
    return context
  }

  if (!contextInit) {
    contextInit = (async () => {
      const { userAgent, extraHeaders } = splitUserAgentHeader(headers)
      browser = await chromium.launch({ headless: true })
      context = await browser.newContext({
        userAgent,
        extraHTTPHeaders: extraHeaders,
      })
      return context
    })().finally(() => {
      contextInit = null
    })
  }

  return contextInit
}

const withPlaywright = async (
  url: string,
  options: CrawlOptions,
  headers: Record<string, string>
): Promise<CrawlResult> => {
  const timeoutMs = options.playwrightTimeout ?? options.timeout ?? DEFAULT_TIMEOUT_MS
  const ctx = await getBrowser(headers)
  const page = await ctx.newPage()

  try {
    if (options.blockResources) {
      await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType()
        if (resourceType === 'image' || resourceType === 'media' || resourceType === 'font') {
          route.abort()
        } else {
          route.continue()
        }
      })
    }

    await page.goto(url, {
      timeout: timeoutMs,
      waitUntil: options.waitForNetworkIdle === false ? 'domcontentloaded' : 'networkidle',
    })

    const html = await page.content()
    return extractFromHtml(url, html, 'playwright')
  } finally {
    await page.close()
  }
}

const withScrapeDo = async (
  url: string,
  options: CrawlOptions,
  _headers: Record<string, string>
): Promise<CrawlResult> => {
  const config = options.scrapeDo
  if (!config?.token) {
    throw new Error('Scrape.do token missing')
  }

  const endpoint = config.endpoint ?? 'https://api.scrape.do'
  const scrapeUrl = new URL(endpoint)
  scrapeUrl.searchParams.set('token', config.token)
  scrapeUrl.searchParams.set('url', url)

  if (config.params) {
    for (const [key, value] of Object.entries(config.params)) {
      scrapeUrl.searchParams.set(key, String(value))
    }
  }

  const scrapeHeaders = buildHeaders(options, config.headers)
  const { html } = await fetchHtml(scrapeUrl.toString(), options, scrapeHeaders)

  return extractFromHtml(url, html, 'scrapeDo')
}

/**
 * Crawl a URL and extract its content as markdown, using a smart fallback chain.
 *
 * Order: fetch -> jsdom render (optional) -> playwright (optional) -> scrape.do (optional)
 */
export async function crawl(url: string, options: CrawlOptions = {}): Promise<CrawlResult> {
  const attempts: CrawlAttempt[] = []
  const enableFetch = options.enableFetch ?? true
  const enableJsdom = options.enableJsdom ?? false
  const enablePlaywright = options.enablePlaywright ?? true
  const enableScrapeDo = options.enableScrapeDo ?? Boolean(options.scrapeDo?.token)

  const headers = buildHeaders(options)
  let fetchedHtml: string | null = null

  if (enableFetch) {
    try {
      const { html } = await fetchHtml(url, options, headers)
      fetchedHtml = html
      const result = extractFromHtml(url, html, 'fetch')

      if (isResultAcceptable(result, options)) {
        attempts.push({ strategy: 'fetch', ok: true })
        return result
      }

      attempts.push({
        strategy: 'fetch',
        ok: false,
        reason: 'Fetch result did not meet acceptance thresholds',
      })
    } catch (error) {
      attempts.push({
        strategy: 'fetch',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (enableJsdom) {
    try {
      const html = fetchedHtml ?? (await fetchHtml(url, options, headers)).html
      const renderedHtml = await renderWithJsdom(url, html, options)
      const result = extractFromHtml(url, renderedHtml, 'jsdom')

      if (isResultAcceptable(result, options)) {
        attempts.push({ strategy: 'jsdom', ok: true })
        return result
      }

      attempts.push({
        strategy: 'jsdom',
        ok: false,
        reason: 'jsdom render did not meet acceptance thresholds',
      })
    } catch (error) {
      attempts.push({
        strategy: 'jsdom',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (enablePlaywright) {
    try {
      const result = await withPlaywright(url, options, headers)
      if (isResultAcceptable(result, options)) {
        attempts.push({ strategy: 'playwright', ok: true })
        return result
      }

      attempts.push({
        strategy: 'playwright',
        ok: false,
        reason: 'Playwright result did not meet acceptance thresholds',
      })
    } catch (error) {
      attempts.push({
        strategy: 'playwright',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (enableScrapeDo) {
    try {
      const result = await withScrapeDo(url, options, headers)
      if (isResultAcceptable(result, options)) {
        attempts.push({ strategy: 'scrapeDo', ok: true })
        return result
      }

      attempts.push({
        strategy: 'scrapeDo',
        ok: false,
        reason: 'Scrape.do result did not meet acceptance thresholds',
      })
    } catch (error) {
      attempts.push({
        strategy: 'scrapeDo',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  throw new CrawlError('All crawl strategies failed', attempts)
}

/**
 * Close the browser instance. Call this when done crawling.
 */
export async function closeBrowser(): Promise<void> {
  contextInit = null
  if (browser) {
    await browser.close()
    browser = null
    context = null
  }
}
