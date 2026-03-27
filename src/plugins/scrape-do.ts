import { createTimeoutSignal } from '../core/http.js'
import type { FetchPlugin } from './types.js'

export const scrapeDoPlugin: FetchPlugin = {
  name: 'scrape-do',
  async fetch(url, config, context) {
    const token = config.token as string | undefined
    if (!token) {
      throw new Error('Scrape.do plugin: token missing')
    }

    const endpoint = (config.endpoint as string) ?? 'https://api.scrape.do'
    const scrapeUrl = new URL(endpoint)
    scrapeUrl.searchParams.set('token', token)
    scrapeUrl.searchParams.set('url', url)

    const params = config.params as Record<string, string | number | boolean> | undefined
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        scrapeUrl.searchParams.set(key, String(value))
      }
    }

    const extraHeaders = (config.headers as Record<string, string>) ?? {}
    const headers = { ...context.headers, ...extraHeaders }

    const timeoutMs = (config.timeout as number) ?? context.timeout
    const { signal, clear } = createTimeoutSignal(timeoutMs)

    try {
      const response = await fetch(scrapeUrl.toString(), {
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

      return await response.text()
    } finally {
      clear()
    }
  },
}
