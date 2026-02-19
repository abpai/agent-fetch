import fs from 'fs'
import path from 'path'

const INTERNAL_URL_PREFIXES = ['chrome://', 'about:', 'file://']

const matchesAny = (value: string, patterns: RegExp[]) =>
  patterns.some((pattern) => pattern.test(value))

/**
 * Config files (optional):
 * - data/blacklist_domains.txt   (one domain suffix per line)
 * - data/url_filters.json        (override/extend defaults)
 */
type UrlFilterConfig = {
  blocked_host_suffixes: string[]
  blocked_host_keywords: string[]
  tracking_params: string[]
}

const DEFAULT_FILTERS: UrlFilterConfig = {
  blocked_host_suffixes: [],
  blocked_host_keywords: [
    'bank',
    'banking',
    'ebank',
    'ebanking',
    'estatements',
    'statement',
    'secure',
    'auth',
    'sso',
    'signin',
    'login',
    'account',
    'accounts',
    'billing',
    'checkout',
    'payment',
    'invoice',
    'verify',
    'otp',
    'portal',
  ],
  tracking_params: [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'fbclid',
    'gclid',
    'ref',
    'source',
    'mc_cid',
    'mc_eid',
    'igshid',
    'si',
  ],
}

function readLinesIfExists(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return []
  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

function loadFilterConfig(dataDir: string): UrlFilterConfig {
  const blacklistDomainsPath = path.join(dataDir, 'blacklist_domains.txt')
  const jsonConfigPath = path.join(dataDir, 'url_filters.json')

  let cfg: UrlFilterConfig = {
    blocked_host_suffixes: [...DEFAULT_FILTERS.blocked_host_suffixes],
    blocked_host_keywords: [...DEFAULT_FILTERS.blocked_host_keywords],
    tracking_params: [...DEFAULT_FILTERS.tracking_params],
  }

  if (fs.existsSync(jsonConfigPath)) {
    try {
      const fromFile = JSON.parse(fs.readFileSync(jsonConfigPath, 'utf-8'))
      cfg = {
        blocked_host_suffixes: [
          ...cfg.blocked_host_suffixes,
          ...(fromFile.blocked_host_suffixes || []),
        ],
        blocked_host_keywords: [
          ...cfg.blocked_host_keywords,
          ...(fromFile.blocked_host_keywords || []),
        ],
        tracking_params: [...cfg.tracking_params, ...(fromFile.tracking_params || [])],
      }
    } catch (err) {
      console.error('Failed to parse data/url_filters.json:', (err as Error).message)
    }
  }

  cfg.blocked_host_suffixes.push(...readLinesIfExists(blacklistDomainsPath))

  cfg.blocked_host_suffixes = Array.from(
    new Set(cfg.blocked_host_suffixes.map((d) => d.toLowerCase()))
  )
  cfg.blocked_host_keywords = Array.from(
    new Set(cfg.blocked_host_keywords.map((k) => k.toLowerCase()))
  )
  cfg.tracking_params = Array.from(new Set(cfg.tracking_params))

  return cfg
}

function hostMatchesSuffix(host: string, suffix: string): boolean {
  if (host === suffix) return true
  return host.endsWith('.' + suffix)
}

function hostHasKeyword(host: string, keywords: string[]): boolean {
  const h = host.toLowerCase()
  return keywords.some((k) => h.includes(k))
}

const BLACKLIST_PATTERNS = [
  /^http:\/\/localhost/,
  /^http:\/\/127\.0\.0\.1/,
  /^http:\/\/0\.0\.0\.0/,
  /^https?:\/\/verizon\.com\/digital\/nsa\/secure\/gw\/bill/,
  /\/unsubscribe/i,
  /\/auth\//i,
  /\/oauth/i,
  /\/session/i,
  /\/login/i,
  /\/signup/i,
  /\/register/i,
  /\/account/i,
  /\/profile/i,
  /\/settings/i,
  /\/billing/i,
  /\/checkout/i,
  /\/cart/i,
  /\/order/i,
  /\/invoice/i,
  /\/payment/i,
  /\/notification/i,
  /\/message/i,
  /\/inbox/i,
  /\/compose/i,
  /\/admin/i,
  /\/dashboard/i,
  /\/console/i,
  /\/workspace/i,
  /\/project/i,
  /\/organization/i,
  /\/callback/i,
  /\/redirect/i,
  /\/token/i,
  /\/password/i,
  /\/reset/i,
]

const BLACKLIST_DOMAIN_PATTERNS = [
  // Search Engines
  /^https?:\/\/(www\.)?(google|bing|duckduckgo|yahoo|baidu)\.com/,
  /^https?:\/\/(www\.)?google\.com\/(search|webhp|$)/,

  // Social Media & Messaging
  /^https?:\/\/(www\.)?(x|twitter|facebook|instagram|linkedin|reddit|bsky\.app|threads\.net|messenger|whatsapp|telegram)\.(com|org|net|app)/,
  /^https?:\/\/(web\.)?(whatsapp|telegram)\.org/,
  /^https?:\/\/t\.co\//,

  // Workspace & Productivity
  /^https?:\/\/(www\.)?(zoom\.us|notion\.so|trello\.com|asana\.com|slack\.com|discord\.com|linear\.app|miro\.com|figma\.com|dropbox\.com)/,
  /^https?:\/\/(app\.)?slack\.com/,
  /^https?:\/\/(meet|chat|mail|calendar|drive|docs|keep|contacts|photos)\.google\.com/,
  /^https?:\/\/(outlook|teams|office|onedrive|sharepoint)\.live\.com/,

  // Development
  /^https?:\/\/(www\.)?(github|gitlab|vercel|netlify|heroku|supabase|datadoghq|circleci|cursor|jointakeoff)\.com/,
  /^https?:\/\/(www\.)?supabase\.com\/(dashboard|project)/,
  /^https?:\/\/(console|us-east-1)\.aws\.amazon\.com/,
  /^https?:\/\/(console)\.cloud\.google\.com/,
  /^https?:\/\/(www\.)?firebase\.google\.com/,
  /^https?:\/\/(www\.)?github\.com\/(notifications|pulls|issues|codespaces|settings|new|organizations)/,
  /^https?:\/\/gist\.github\.com/,
  /^https?:\/\/forum\.cursor\.com/,

  // Financial & Legal
  /^https?:\/\/(www\.)?(robinhood|fidelity|vanguard|chase|bankofamerica|paypal|stripe|coinbase|schwab|amex|americanexpress|mercury|brex|firstbankpr|1firstbank|wealthfront|ramp|finbox|yieldstreet|recurly|netsuite)\.com/,
  /^https?:\/\/(dashboard\.)?stripe\.com/,
  /^https?:\/\/js\.stripe\.com/,
  /^https?:\/\/.*chase\.com\/.*(accounts|login|dashboard)/,
  /^https?:\/\/myaccounts\.capitalone\.com/,
  /^https?:\/\/app\.ramp\.com/,
  /^https?:\/\/(www\.)?investing\.com\/pro/,
  /^https?:\/\/suri\.hacienda\.pr\.gov/,

  // AI
  /^https?:\/\/(chatgpt|chat)\.com/,
  /^https?:\/\/chat\.openai\.com/,
  /^https?:\/\/platform\.openai\.com/,
  /^https?:\/\/community\.openai\.com/,
  /^https?:\/\/(www\.)?(claude\.ai|perplexity\.ai|openrouter\.ai|sora\.com)/,
  /^https?:\/\/(www\.)?(gemini|notebooklm|aistudio|colab\.research|labs)\.google\.com/,

  // Entertainment
  /^https?:\/\/(www\.)?(youtube|netflix|hulu|spotify|twitch)\.com/,
  /^https?:\/\/m\.youtube\.com/,
  /^https?:\/\/(open\.)?spotify\.com/,
  /^https?:\/\/challenge\.spotify\.com/,

  // Utilities & Services
  /^https?:\/\/(www\.)?(amazon|namecheap)\.com/,
  /^https?:\/\/(www\.)?pica-ai\.com/,
  /^https?:\/\/news\.ycombinator\.com/,
  /^https?:\/\/bookface\.ycombinator\.com/,
  /^https?:\/\/mermaid\.live/,
  /^https?:\/\/(myaccount|accounts|myactivity)\.google\.com/,
  /^https?:\/\/app\.hellosign\.com/,
  /^https?:\/\/(members\.myhampton|infinity\.icicibank|secure\.icicidirect|accounts\.hetzner|youtube\.auth-gateway)\.com/,
  /^https?:\/\/(www\.)?strava\.com/,
  /^https?:\/\/(www\.)?seasons4u\.com/,
  /^https?:\/\/(console|login)\./,
  /^https?:\/\/globalurl\.fortinet\.net/,
  /^https?:\/\/app\.venture360\.co/,
  /^https?:\/\/client\.forgeglobal\.com/,
]

const BLACKLIST_TITLES_PARTIAL = [
  'Sign in',
  'Log in',
  'Login',
  'Signup',
  'Sign up',
  'Notifications',
  'Dashboard',
  'Inbox',
  'Account',
  'Settings',
  'Password Manager',
  'InvestingPro',
  'My LastPass Vault',
  'Cloudflare',
  'Just a moment',
  'Verification',
  'Two-factor',
  'Access denied',
  'Forbidden',
  'Not found',
  'Error 404',
  'Page not found',
  'Unauthorized',
  'My Profile',
  'My Account',
  'My Projects',
  'My Workspace',
  'Cart',
  'Checkout',
  'Order History',
  'Order Details',
  'Subscription',
  'Billing',
  'Preferences',
  'Loading...',
  'Please Wait',
]

const BLACKLIST_TITLES_EXACT = [
  'YouTube',
  'X',
  'Twitter',
  'Claude',
  'ChatGPT',
  'Google Gemini',
  'NotebookLM',
  'Home',
  'Feed',
]

const BLOCKED_PATH_SEGMENTS = new Set([
  'login',
  'log-in',
  'signin',
  'sign-in',
  'signup',
  'sign-up',
  'logout',
  'register',
  'account',
  'accounts',
  'settings',
  'preferences',
  'billing',
  'invoice',
  'invoices',
  'coupon',
  'coupons',
  'dashboard',
  'pricing',
  'plans',
  'plan',
  'subscribe',
  'subscription',
  'subscriptions',
  'status',
  'checkout',
  'cart',
  'payment',
  'payments',
  'notifications',
  'messages',
  'messaging',
  'inbox',
  'compose',
  'feed',
  'explore',
  'home',
  'admin',
  'console',
  'project',
  'projects',
  'workspace',
  'workspaces',
  'team',
  'teams',
  'org',
  'orgs',
  'organization',
  'organizations',
  'new',
  'edit',
  'delete',
  'create',
  'oauth',
  'auth',
  'authorize',
  'token',
  'callback',
  'redirect',
  'profile',
  'me',
  'my',
  'session',
  'sessions',
  'auth-callback',
  'password-reset',
  'reset-password',
  'verify-email',
  'security',
  'api',
  'v1',
  'v2',
  'v3',
  'internal',
  'private',
  'personal',
  'user',
  'users',
  'member',
  'members',
  'client',
  'clients',
  'customer',
  'customers',
  'portal',
  'app',
  'mobile',
  'beta',
  'staging',
  'dev',
  'local',
  'test',
])

const BLOCKED_PATH_SUBSTRINGS = [
  'oauth',
  'authorize',
  'auth',
  'login',
  'signin',
  'signup',
  'session',
  'security-check',
]

const DYNAMIC_PATH_PATTERNS = [
  /^\/(search|tag|tags|category|categories|topic|topics|author|authors|archive|archives|feed|rss)\/?/i,
  /^\/(latest|popular|trending)\/?$/i,
  /^\/(pricing|plans|subscribe|subscriptions|status|models)\/?$/i,
  /\/page\/\d+\/?$/i,
  /\/[a-f0-9]{32,}\/?/i, // UUID-like strings
  /\/\d{10,}\/?/, // Long numeric IDs
]

const DYNAMIC_QUERY_KEYS = new Set([
  'q',
  'query',
  'search',
  's',
  'session',
  'sessionid',
  'sid',
  'token',
  'auth',
  'uid',
  'userid',
  'user_id',
  'client_id',
  'api_key',
  'apikey',
  'access_token',
  'refresh_token',
  'id_token',
  'state',
  'code',
  'nonce',
  'next',
  'return_to',
  'redirect_uri',
])

function normalizeUrl(
  rawUrl: string,
  trackingParams: Set<string>
): { url_norm: string; domain: string; path: string } | null {
  try {
    const url = new URL(rawUrl)

    for (const param of trackingParams) {
      url.searchParams.delete(param)
    }

    url.hostname = url.hostname.toLowerCase()
    const pathname = url.pathname.replace(/\/+$/, '') || '/'

    url.searchParams.sort()

    const url_norm = url.origin + pathname + (url.search || '')
    const domain = url.hostname.replace(/^www\./, '')

    return { url_norm, domain, path: pathname }
  } catch {
    return null
  }
}

function titleMatchesBlacklist(title: string): boolean {
  const normalized = title.trim()
  if (!normalized) return false

  const titleLower = normalized.toLowerCase()

  if (BLACKLIST_TITLES_PARTIAL.some((blocked) => titleLower.includes(blocked.toLowerCase())))
    return true

  if (
    BLACKLIST_TITLES_EXACT.some(
      (blocked) =>
        normalized === blocked ||
        normalized.startsWith(blocked + ' -') ||
        normalized.startsWith(blocked + ' |') ||
        normalized.endsWith('- ' + blocked) ||
        normalized.endsWith('| ' + blocked)
    )
  )
    return true

  return false
}

function isBlockedByPathSegments(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    const segments = url.pathname
      .split('/')
      .map((seg) => seg.trim().toLowerCase())
      .filter(Boolean)

    if (segments.some((seg) => BLOCKED_PATH_SEGMENTS.has(seg))) return true
    if (segments.some((seg) => BLOCKED_PATH_SUBSTRINGS.some((sub) => seg.includes(sub))))
      return true

    return false
  } catch {
    return false
  }
}

function isDynamicListingUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    const pathname = url.pathname.replace(/\/+$/, '') || '/'
    if (DYNAMIC_PATH_PATTERNS.some((pattern) => pattern.test(pathname))) return true

    for (const key of DYNAMIC_QUERY_KEYS) {
      if (url.searchParams.has(key)) return true
    }

    return false
  } catch {
    return false
  }
}

function getBlockReason(rawUrl: string, title: string, cfg: UrlFilterConfig): string | null {
  if (titleMatchesBlacklist(title)) return 'title_blacklist'
  if (matchesAny(rawUrl, BLACKLIST_PATTERNS)) return 'url_pattern_blacklist'
  if (matchesAny(rawUrl, BLACKLIST_DOMAIN_PATTERNS)) return 'domain_pattern_blacklist'
  if (isBlockedByPathSegments(rawUrl)) return 'blocked_path_segment'
  if (isDynamicListingUrl(rawUrl)) return 'dynamic_url'

  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '')

    if (hostHasKeyword(host, cfg.blocked_host_keywords)) return 'host_keyword'
    if (cfg.blocked_host_suffixes.some((s) => hostMatchesSuffix(host, s))) return 'host_suffix'
  } catch {
    return 'invalid_url'
  }

  return null
}

interface HistoryItem {
  url: string
  title?: string
  time_usec?: number
}

interface UrlStats {
  url_norm: string
  domain: string
  path: string
  count: number
  firstVisit: number
  lastVisit: number
  title: string
  visits: number[]
}

interface PrioritizedUrl {
  url: string
  count: number
  lastVisit: number
  title: string
}

function processHistoryFiles(dataDir: string): {
  urlStats: Map<string, UrlStats>
  sorted: PrioritizedUrl[]
  report: {
    total_items: number
    unique_kept: number
    blocked_items: number
    blocked_by_reason: Record<string, number>
    samples: Record<string, { url: string; title: string }[]>
    config: UrlFilterConfig
  }
} {
  const cfg = loadFilterConfig(dataDir)
  const trackingParams = new Set(cfg.tracking_params)
  const files = fs
    .readdirSync(dataDir)
    .filter((f) => f.endsWith('.json') && f !== 'url_queue.json')

  if (files.length === 0) {
    console.log('No history files found in data/')
    process.exit(0)
  }

  console.log(`Processing ${files.length} history files...`)

  const urlStats = new Map<string, UrlStats>()
  const reasonCounts: Record<string, number> = {}
  const reasonSamples: Record<string, { url: string; title: string }[]> = {}
  let blockedCount = 0
  let totalItems = 0

  for (const file of files) {
    const filePath = path.join(dataDir, file)
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      const rawHistory = content['Browser History']
      const history: HistoryItem[] = Array.isArray(rawHistory) ? rawHistory : []

      for (const item of history) {
        totalItems++

        if (!item.url || INTERNAL_URL_PREFIXES.some((prefix) => item.url.startsWith(prefix)))
          continue

        const reason = getBlockReason(item.url, item.title || '', cfg)
        if (reason) {
          blockedCount++
          reasonCounts[reason] = (reasonCounts[reason] || 0) + 1
          if (!reasonSamples[reason]) reasonSamples[reason] = []
          if (reasonSamples[reason].length < 25) {
            reasonSamples[reason].push({ url: item.url, title: item.title || '' })
          }
          continue
        }

        const normalized = normalizeUrl(item.url, trackingParams)
        if (!normalized) continue

        const visitTime = item.time_usec ? item.time_usec / 1000 : Date.now()

        const stats = urlStats.get(normalized.url_norm)
        if (stats) {
          stats.count++
          stats.firstVisit = Math.min(stats.firstVisit, visitTime)
          stats.lastVisit = Math.max(stats.lastVisit, visitTime)
          stats.visits.push(visitTime)
          if (!stats.title && item.title) stats.title = item.title
        } else {
          urlStats.set(normalized.url_norm, {
            url_norm: normalized.url_norm,
            domain: normalized.domain,
            path: normalized.path,
            count: 1,
            firstVisit: visitTime,
            lastVisit: visitTime,
            title: item.title || '',
            visits: [visitTime],
          })
        }
      }
    } catch (err) {
      console.error(`Failed to parse ${file}:`, (err as Error).message)
    }
  }

  console.log(`Processed ${totalItems} history items`)
  console.log(`Deduplicated to ${urlStats.size} unique URLs`)
  console.log(`Filtered out ${blockedCount} blocked URLs`)

  const sorted = Array.from(urlStats.values())
    .sort((a, b) => b.count - a.count || b.lastVisit - a.lastVisit)
    .map((s) => ({
      url: s.url_norm,
      count: s.count,
      lastVisit: s.lastVisit,
      title: s.title,
    }))

  const report = {
    total_items: totalItems,
    unique_kept: urlStats.size,
    blocked_items: blockedCount,
    blocked_by_reason: Object.fromEntries(
      Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])
    ),
    samples: reasonSamples,
    config: cfg,
  }

  return { urlStats, sorted, report }
}

function main() {
  const dataDir = path.resolve(process.cwd(), 'data')
  const outputFilePath = path.join(dataDir, 'url_queue.json')

  if (!fs.existsSync(dataDir)) {
    console.error('data/ directory not found. Place browser history JSON files there.')
    process.exit(1)
  }

  const { sorted, report } = processHistoryFiles(dataDir)

  const output = {
    stats: {
      total_items: report.total_items,
      unique_kept: report.unique_kept,
      blocked_items: report.blocked_items,
      blocked_by_reason: report.blocked_by_reason,
    },
    urls: sorted,
  }

  fs.writeFileSync(outputFilePath, JSON.stringify(output, null, 2))
  console.log(`\nSaved ${sorted.length} URLs to ${outputFilePath}`)

  console.log('\nTop 50 URLs by visit frequency:')
  console.log('-'.repeat(80))
  const trim = (str: string) => (str.length > 50 ? str.slice(0, 50) + '...' : str)

  const topUrls = sorted.slice(0, 50).map((item) => ({
    date: new Date(item.lastVisit).toISOString().slice(0, 10),
    title: trim(item.title),
    hostname: trim(new URL(item.url).hostname),
  }))
  console.table(topUrls)
}

main()
