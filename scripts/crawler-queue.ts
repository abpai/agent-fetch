import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { createClient } from 'redis'

type FetchResult = {
  ok: boolean
  status: number
  contentType: string
  bodyBytes: number
  bodyText: string | null
  bodyRaw: Buffer
  finalUrl: string
  error?: string
  via?: string
}

type Decision = {
  shouldFallback: boolean
  shouldRender: boolean
  reason: string
}

type DecisionStep = Decision & { step: 'local' | 'scrapedo'; status: number; via: string }

type ScrapedoOptions = {
  shouldRender: boolean
  allowRenderOnBlock: boolean
}

const CONFIG = {
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  scrapedoToken: process.env.SCRAPEDO_TOKEN || '',
  inputFile: process.env.INPUT_FILE || path.resolve(process.cwd(), 'urls.txt'),
  outDir: process.env.OUT_DIR || path.resolve(process.cwd(), 'out'),
  concurrency: Number(process.env.CONCURRENCY || 5),

  localTimeoutMs: Number(process.env.LOCAL_TIMEOUT_MS || 20000),
  scrapedoTimeoutMs: Number(process.env.SCRAPEDO_TIMEOUT_MS || 60000),

  queueKey: 'url_queue',
  seenKey: 'url_seen',
  doneKey: 'url_done',

  blacklistDomainsFile:
    process.env.BLACKLIST_DOMAINS_FILE ||
    path.resolve(process.cwd(), 'data', 'blacklist_domains.txt'),

  minTextChars: Number(process.env.MIN_TEXT_CHARS || 800),
  maxHtmlBytesForLocal: Number(process.env.MAX_HTML_BYTES_FOR_LOCAL || 2_500_000),

  scrapedoBaseUrl: 'https://api.scrape.do/',
  scrapedoTryProxyFirst: true,
  scrapedoSuper: process.env.SCRAPEDO_SUPER === 'true',
  scrapedoGeoCode: process.env.SCRAPEDO_GEO_CODE || '',
  scrapedoCustomHeaders: process.env.SCRAPEDO_CUSTOM_HEADERS === 'true',
  scrapedoExtraHeaders: process.env.SCRAPEDO_EXTRA_HEADERS === 'true',
  scrapedoForwardHeaders: process.env.SCRAPEDO_FORWARD_HEADERS === 'true',
  scrapedoBlockResources: process.env.SCRAPEDO_BLOCK_RESOURCES || '',
  scrapedoCustomWaitMs: process.env.SCRAPEDO_CUSTOM_WAIT_MS || '',
  scrapedoRenderOnBlock: process.env.SCRAPEDO_RENDER_ON_BLOCK === 'true',
  scrapedoRenderUnblock: process.env.SCRAPEDO_RENDER_UNBLOCK === 'true',
  scrapedoHeadersJson: process.env.SCRAPEDO_HEADERS_JSON || '',
}

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function readLines(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return []
  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

function sha1(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex')
}

function hostMatchesSuffix(host: string, suffix: string): boolean {
  if (host === suffix) return true
  return host.endsWith(`.${suffix}`)
}

function loadBlacklistDomains(): Set<string> {
  const domains = readLines(CONFIG.blacklistDomainsFile).map((d) => d.toLowerCase())
  return new Set(domains)
}

function normalizeUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl.trim())
    url.hash = ''

    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'fbclid',
      'gclid',
      'igshid',
      'mc_cid',
      'mc_eid',
      'ref',
      'source',
    ]
    for (const param of trackingParams) url.searchParams.delete(param)
    url.searchParams.sort()

    url.hostname = url.hostname.toLowerCase()
    const pathname = (url.pathname || '/').replace(/\/+$/, '') || '/'
    const norm = url.origin + pathname + (url.search || '')

    return norm
  } catch {
    return null
  }
}

function parseHeadersJson(raw: string): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const entries = Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [k, String(v)]),
    ) as Record<string, string>
    if (CONFIG.scrapedoExtraHeaders) {
      return Object.fromEntries(
        Object.entries(entries).map(([k, v]) => {
          if (/^sd-/i.test(k)) return [k, v]
          return [`sd-${k}`, v]
        }),
      ) as Record<string, string>
    }
    return entries
  } catch {
    return {}
  }
}

function looksLikeBlockedPage(html: string): boolean {
  const s = html.toLowerCase()
  const needles = [
    'just a moment',
    'attention required',
    'verify you are human',
    'checking your browser',
    'cloudflare',
    'captcha',
    'access denied',
    'request blocked',
    'unusual traffic',
    'enable javascript',
    'are you a robot',
  ]
  return needles.some((n) => s.includes(n))
}

function stripHtmlToText(html: string): string {
  let s = html
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
  s = s.replace(/<[^>]+>/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

function analyzeHtmlHeuristics(html: string): {
  blocked: boolean
  needsRender: boolean
  textChars: number
} {
  const totalChars = html.length
  const scriptTags = (html.match(/<script[\s\S]*?>/gi) || []).length
  const hasNoScriptHint = /<noscript[\s\S]*?>/i.test(html)
  const blocked = looksLikeBlockedPage(html)

  const text = stripHtmlToText(html)
  const textChars = text.length

  const scriptHeavy = scriptTags / Math.max(totalChars, 1) > 0.06
  const needsRender =
    !blocked && textChars < CONFIG.minTextChars && (scriptHeavy || hasNoScriptHint)

  return { blocked, needsRender, textChars }
}

function shouldFallbackToScrapedo(respInfo: FetchResult | null): Decision {
  if (!respInfo)
    return { shouldFallback: true, shouldRender: false, reason: 'no_response' }

  const { status, contentType, bodyText, bodyBytes } = respInfo

  if ([401, 403, 429, 503].includes(status)) {
    return { shouldFallback: true, shouldRender: false, reason: 'http_blocked' }
  }

  if (!contentType) {
    return { shouldFallback: true, shouldRender: false, reason: 'missing_content_type' }
  }

  if (
    contentType.includes('application/pdf') ||
    contentType.includes('application/json')
  ) {
    return { shouldFallback: false, shouldRender: false, reason: 'non_html_ok' }
  }

  if (!contentType.includes('text/html')) {
    if (contentType.includes('text/')) {
      return { shouldFallback: false, shouldRender: false, reason: 'text_ok' }
    }
    return {
      shouldFallback: true,
      shouldRender: false,
      reason: 'unsupported_content_type',
    }
  }

  if (bodyBytes > CONFIG.maxHtmlBytesForLocal) {
    return { shouldFallback: true, shouldRender: false, reason: 'too_large_local' }
  }

  const { blocked, needsRender } = analyzeHtmlHeuristics(bodyText || '')
  if (blocked)
    return { shouldFallback: true, shouldRender: false, reason: 'blocked_html' }
  if (needsRender)
    return { shouldFallback: true, shouldRender: true, reason: 'needs_render' }

  return { shouldFallback: false, shouldRender: false, reason: 'local_ok' }
}

async function fetchWithTimeout(
  url: string,
  opts: RequestInit,
  timeoutMs: number,
): Promise<FetchResult> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal })
    const contentType = (res.headers.get('content-type') || '').toLowerCase()
    const arrayBuf = await res.arrayBuffer()
    const bodyBytes = arrayBuf.byteLength

    let bodyText: string | null = null
    if (
      contentType.includes('text/') ||
      contentType.includes('application/json') ||
      contentType.includes('text/html')
    ) {
      bodyText = Buffer.from(arrayBuf).toString('utf-8')
    }

    return {
      ok: res.ok,
      status: res.status,
      contentType,
      bodyBytes,
      bodyText,
      bodyRaw: Buffer.from(arrayBuf),
      finalUrl: res.url || url,
    }
  } finally {
    clearTimeout(t)
  }
}

async function tryLocalFetch(targetUrl: string): Promise<FetchResult> {
  const headers = {
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  }

  try {
    return await fetchWithTimeout(
      targetUrl,
      { method: 'GET', headers, redirect: 'follow' },
      CONFIG.localTimeoutMs,
    )
  } catch (err) {
    return {
      ok: false,
      status: 0,
      contentType: '',
      bodyBytes: 0,
      bodyText: '',
      bodyRaw: Buffer.from(''),
      finalUrl: targetUrl,
      error: String(err),
    }
  }
}

function buildScrapedoUrl(targetUrl: string, params: Record<string, string>): string {
  const u = new URL(CONFIG.scrapedoBaseUrl)
  u.searchParams.set('token', CONFIG.scrapedoToken)
  u.searchParams.set('url', targetUrl)

  for (const [k, v] of Object.entries(params || {})) {
    u.searchParams.set(k, String(v))
  }

  return u.toString()
}

async function tryScrapedoFetch(
  targetUrl: string,
  { shouldRender, allowRenderOnBlock }: ScrapedoOptions,
): Promise<FetchResult> {
  if (!CONFIG.scrapedoToken) {
    return {
      ok: false,
      status: 0,
      contentType: '',
      bodyBytes: 0,
      bodyText: '',
      bodyRaw: Buffer.from(''),
      finalUrl: targetUrl,
      error: 'missing_scrapedo_token',
    }
  }

  const attempts: { name: string; params: Record<string, string> }[] = []
  const baseParams: Record<string, string> = {}

  if (CONFIG.scrapedoSuper) baseParams.super = 'true'
  if (CONFIG.scrapedoGeoCode) baseParams.geoCode = CONFIG.scrapedoGeoCode
  if (CONFIG.scrapedoCustomHeaders) baseParams.customHeaders = 'true'
  if (CONFIG.scrapedoExtraHeaders) baseParams.extraHeaders = 'true'
  if (CONFIG.scrapedoForwardHeaders) baseParams.forwardHeaders = 'true'

  if (CONFIG.scrapedoTryProxyFirst) {
    attempts.push({ name: 'scrapedo_proxy', params: { ...baseParams, render: 'false' } })
  }

  if (shouldRender) {
    const renderParams: Record<string, string> = { ...baseParams, render: 'true' }
    if (CONFIG.scrapedoBlockResources) {
      renderParams.blockResources = CONFIG.scrapedoBlockResources
    }
    if (CONFIG.scrapedoCustomWaitMs) {
      renderParams.customWait = CONFIG.scrapedoCustomWaitMs
    }
    attempts.push({ name: 'scrapedo_render', params: renderParams })

    if (CONFIG.scrapedoRenderUnblock) {
      attempts.push({
        name: 'scrapedo_render_unblock',
        params: {
          ...baseParams,
          render: 'true',
          blockResources: 'false',
          customWait: '2000',
        },
      })
    }
  } else if (allowRenderOnBlock) {
    attempts.push({
      name: 'scrapedo_render_on_block',
      params: {
        ...baseParams,
        render: 'true',
        blockResources: CONFIG.scrapedoBlockResources || 'true',
      },
    })
  }

  if (attempts.length === 0) {
    attempts.push({ name: 'scrapedo_proxy', params: { ...baseParams, render: 'false' } })
  }

  let last: FetchResult | null = null
  for (const attempt of attempts) {
    const apiUrl = buildScrapedoUrl(targetUrl, attempt.params)
    try {
      const headers = parseHeadersJson(CONFIG.scrapedoHeadersJson)
      const resp = await fetchWithTimeout(
        apiUrl,
        {
          method: 'GET',
          headers: { accept: '*/*', ...headers },
          redirect: 'follow',
        },
        CONFIG.scrapedoTimeoutMs,
      )
      resp.via = attempt.name
      last = resp

      const decision = shouldFallbackToScrapedo(resp)
      if (!decision.shouldFallback) return resp
    } catch (err) {
      last = {
        ok: false,
        status: 0,
        contentType: '',
        bodyBytes: 0,
        bodyText: '',
        bodyRaw: Buffer.from(''),
        finalUrl: targetUrl,
        error: String(err),
        via: attempt.name,
      }
    }
  }

  return (
    last ?? {
      ok: false,
      status: 0,
      contentType: '',
      bodyBytes: 0,
      bodyText: '',
      bodyRaw: Buffer.from(''),
      finalUrl: targetUrl,
      error: 'scrapedo_failed',
    }
  )
}

function safeFilenameFromUrl(url: string): string {
  return sha1(url)
}

function saveResult({
  url,
  result,
  decisionChain,
}: {
  url: string
  result: FetchResult
  decisionChain: DecisionStep[]
}) {
  ensureDir(CONFIG.outDir)

  const id = safeFilenameFromUrl(url)
  const metaPath = path.join(CONFIG.outDir, `${id}.json`)
  const bodyPath = path.join(CONFIG.outDir, `${id}.body`)

  fs.writeFileSync(bodyPath, result.bodyRaw || Buffer.from(''))

  const meta = {
    url,
    finalUrl: result.finalUrl || url,
    fetchedAt: new Date().toISOString(),
    status: result.status,
    contentType: result.contentType,
    bytes: result.bodyBytes,
    via: result.via || 'local',
    decisionChain,
    bodyPath: path.basename(bodyPath),
    error: result.error || null,
  }

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
  return { id, metaPath, bodyPath }
}

async function enqueueUrls(
  redis: ReturnType<typeof createClient>,
  blacklistDomains: Set<string>,
) {
  if (!fs.existsSync(CONFIG.inputFile)) {
    console.error('Missing INPUT_FILE:', CONFIG.inputFile)
    process.exit(1)
  }

  const lines = readLines(CONFIG.inputFile)
  let enqueued = 0
  let skipped = 0

  for (const raw of lines) {
    const norm = normalizeUrl(raw)
    if (!norm) {
      skipped++
      continue
    }

    const host = new URL(norm).hostname.replace(/^www\./, '').toLowerCase()
    const isBlacklisted = Array.from(blacklistDomains).some((d) =>
      hostMatchesSuffix(host, d),
    )
    if (isBlacklisted) {
      skipped++
      continue
    }

    const added = await redis.sAdd(CONFIG.seenKey, norm)
    if (added === 1) {
      await redis.lPush(CONFIG.queueKey, norm)
      enqueued++
    }
  }

  console.log(
    `Enqueued ${enqueued} urls, skipped ${skipped}, total input ${lines.length}`,
  )
}

async function processOneUrl(redis: ReturnType<typeof createClient>, url: string) {
  const decisionChain: DecisionStep[] = []

  const local = await tryLocalFetch(url)
  const localDecision = shouldFallbackToScrapedo(local)
  decisionChain.push({
    step: 'local',
    ...localDecision,
    status: local.status,
    via: 'local',
  })

  if (!localDecision.shouldFallback) {
    saveResult({ url, result: local, decisionChain })
    await redis.sAdd(CONFIG.doneKey, url)
    return
  }

  const allowRenderOnBlock =
    CONFIG.scrapedoRenderOnBlock &&
    !localDecision.shouldRender &&
    (localDecision.reason === 'http_blocked' || localDecision.reason === 'blocked_html')

  const scrapedo = await tryScrapedoFetch(url, {
    shouldRender: localDecision.shouldRender,
    allowRenderOnBlock,
  })
  const scrapedoDecision = shouldFallbackToScrapedo(scrapedo)
  decisionChain.push({
    step: 'scrapedo',
    ...scrapedoDecision,
    status: scrapedo.status,
    via: scrapedo.via || 'scrapedo',
  })

  saveResult({ url, result: scrapedo, decisionChain })
  await redis.sAdd(CONFIG.doneKey, url)
}

async function workerLoop(workerId: number, redis: ReturnType<typeof createClient>) {
  while (true) {
    const popped = await redis.brPop(CONFIG.queueKey, 0)
    const url = popped?.element || null
    if (!url) continue

    try {
      await processOneUrl(redis, url)
      if (workerId === 1) console.log('done', url)
    } catch (err) {
      console.error('worker error', workerId, url, String(err))
    }
  }
}

async function main() {
  ensureDir(CONFIG.outDir)

  const blacklistDomains = loadBlacklistDomains()

  const mode = process.argv[2] || 'worker'

  if (mode === 'enqueue') {
    const redis = createClient({ url: CONFIG.redisUrl })
    redis.on('error', (err) => console.error('redis error', err))
    await redis.connect()

    await enqueueUrls(redis, blacklistDomains)
    await redis.quit()
    return
  }

  console.log(`Starting ${CONFIG.concurrency} workers`)
  const workers: Promise<void>[] = []

  for (let i = 0; i < CONFIG.concurrency; i++) {
    const redis = createClient({ url: CONFIG.redisUrl })
    redis.on('error', (err) => console.error('redis error', err))
    await redis.connect()
    workers.push(workerLoop(i + 1, redis))
  }

  await Promise.all(workers)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
