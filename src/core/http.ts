import type { FetchOptions } from './types'

export const DEFAULT_TIMEOUT_MS = 30_000

export const DEFAULT_USER_AGENT =
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

export const buildHeaders = (
  options: Pick<FetchOptions, 'headers' | 'userAgent'>,
  overrides?: Record<string, string>,
): Record<string, string> => {
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

export const createTimeoutSignal = (timeoutMs: number) => {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(new Error('Request timed out')),
    timeoutMs,
  )

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  }
}
