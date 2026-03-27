import { DEFAULT_TIMEOUT_MS, createTimeoutSignal } from '../core/http.js'
import type { FetchEngineContext } from '../core/types.js'

export const runFetchStrategy = async (
  url: string,
  context: FetchEngineContext
): Promise<string> => {
  const timeoutMs = context.options.fetchTimeout ?? context.options.timeout ?? DEFAULT_TIMEOUT_MS
  const { signal, clear } = createTimeoutSignal(timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: context.headers,
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
}
