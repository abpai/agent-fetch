import { validateResult } from './acceptance'
import { extractFromHtml } from './extract'
import { buildHeaders, DEFAULT_TIMEOUT_MS } from './http'
import type { FetchAttempt, FetchOptions, FetchResult, StrategyMode } from './types'
import { FetchError } from './types'
import { resolvePlugins } from '../plugins/registry'
import { runFetchStrategy } from '../strategies/fetch'
import { runJsdomStrategy } from '../strategies/jsdom'
import { runAgentBrowserStrategy } from '../strategies/agent-browser'

const pickMode = (options: FetchOptions): StrategyMode => {
  if (options.withCredentials) {
    return 'authenticated'
  }

  return options.strategyMode ?? 'auto'
}

const cleanErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

const recordErrorAttempt = (
  attempts: FetchAttempt[],
  strategy: FetchAttempt['strategy'],
  error: unknown,
  durationMs = 0,
): void => {
  attempts.push({
    strategy,
    ok: false,
    error: cleanErrorMessage(error),
    durationMs,
  })
}

const ensureNotSimpleFailure = (mode: StrategyMode, attempts: FetchAttempt[]): void => {
  if (mode === 'simple') {
    throwAllFailed(attempts)
  }
}

const isCredentialsMissingError = (message: string): boolean =>
  message.includes('Missing AGENT_FETCH_PROFILE')

const timed = async <T>(
  fn: () => Promise<T>,
): Promise<{ value: T; durationMs: number }> => {
  const start = Date.now()
  const value = await fn()
  return { value, durationMs: Date.now() - start }
}

const withAttempts = (result: FetchResult, attempts: FetchAttempt[]): FetchResult => {
  return {
    ...result,
    attempts: attempts.map((attempt) => ({ ...attempt })),
  }
}

const acceptedOrRejected = (
  result: FetchResult,
  attempts: FetchAttempt[],
  strategy: FetchAttempt['strategy'],
  durationMs: number,
  options: FetchOptions,
): FetchResult | null => {
  const validated = validateResult(result, options)

  if (!validated.acceptable) {
    attempts.push({ strategy, ok: false, reason: validated.reason, durationMs })
    return null
  }

  attempts.push({ strategy, ok: true, durationMs })
  return withAttempts(result, attempts)
}

const throwAllFailed = (attempts: FetchAttempt[]): never => {
  throw new FetchError('All fetch strategies failed', attempts)
}

const throwAuthenticatedFailure = (attempts: FetchAttempt[]): never => {
  throw new FetchError(
    'Authenticated fetch failed via agent-browser. Verify `agent-fetch setup`, `--profile`, or AGENT_FETCH_PROFILE configuration.',
    attempts,
  )
}

export const fetchUrl = async (
  url: string,
  options: FetchOptions = {},
): Promise<FetchResult> => {
  const attempts: FetchAttempt[] = []
  const mode = pickMode(options)
  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS
  const headers = buildHeaders(options)
  const environment = options.environment ?? {}

  const context = {
    timeoutMs,
    headers,
    options,
    environment,
  }

  const enableFetch = options.enableFetch ?? true
  const enableJsdom = options.enableJsdom ?? true
  const enablePlugins = options.enablePlugins ?? true
  const enableAgentBrowser = options.enableAgentBrowser ?? true

  const runAuthenticated = async (): Promise<FetchResult> => {
    try {
      const run = await timed(() => runAgentBrowserStrategy(url, context, true))
      const extracted = await extractFromHtml(
        url,
        run.value,
        'agent-browser',
        options.outputMode,
      )
      const accepted = acceptedOrRejected(
        extracted,
        attempts,
        'agent-browser',
        run.durationMs,
        options,
      )
      if (accepted) {
        return accepted
      }

      return throwAuthenticatedFailure(attempts)
    } catch (error) {
      if (error instanceof FetchError) {
        throw error
      }

      recordErrorAttempt(attempts, 'agent-browser', error)
      return throwAuthenticatedFailure(attempts)
    }
  }

  if (mode === 'authenticated') {
    return runAuthenticated()
  }

  let fetchedHtml: string | null = null

  if (enableFetch) {
    try {
      const run = await timed(() => runFetchStrategy(url, context))
      fetchedHtml = run.value
      const extracted = await extractFromHtml(url, run.value, 'fetch', options.outputMode)
      const accepted = acceptedOrRejected(
        extracted,
        attempts,
        'fetch',
        run.durationMs,
        options,
      )
      if (accepted) {
        return accepted
      }

      ensureNotSimpleFailure(mode, attempts)
    } catch (error) {
      if (error instanceof FetchError) {
        throw error
      }

      recordErrorAttempt(attempts, 'fetch', error)
      ensureNotSimpleFailure(mode, attempts)
    }
  }

  if (enableJsdom && mode === 'auto') {
    try {
      const html = fetchedHtml ?? (await runFetchStrategy(url, context))
      const run = await timed(() => runJsdomStrategy(url, html, context))
      const extracted = await extractFromHtml(url, run.value, 'jsdom', options.outputMode)
      const accepted = acceptedOrRejected(
        extracted,
        attempts,
        'jsdom',
        run.durationMs,
        options,
      )
      if (accepted) {
        return accepted
      }
    } catch (error) {
      recordErrorAttempt(attempts, 'jsdom', error)
    }
  }

  if (enablePlugins && mode === 'auto') {
    const configs = options.plugins ?? []
    if (configs.length > 0) {
      const resolvedPlugins = resolvePlugins(configs, environment)

      for (const { plugin, config } of resolvedPlugins) {
        try {
          const run = await timed(() =>
            plugin.fetch(url, config, {
              headers,
              timeout: timeoutMs,
              environment,
            }),
          )

          const extracted = await extractFromHtml(
            url,
            run.value,
            plugin.name,
            options.outputMode,
          )
          const accepted = acceptedOrRejected(
            extracted,
            attempts,
            plugin.name,
            run.durationMs,
            options,
          )
          if (accepted) {
            return accepted
          }
        } catch (error) {
          recordErrorAttempt(attempts, plugin.name, error)
        }
      }
    }
  }

  if (enableAgentBrowser && mode === 'auto') {
    try {
      const run = await timed(() => runAgentBrowserStrategy(url, context, false))
      const extracted = await extractFromHtml(
        url,
        run.value,
        'agent-browser',
        options.outputMode,
      )
      const accepted = acceptedOrRejected(
        extracted,
        attempts,
        'agent-browser',
        run.durationMs,
        options,
      )
      if (accepted) {
        return accepted
      }
    } catch (error) {
      const message = cleanErrorMessage(error)

      if (!isCredentialsMissingError(message)) {
        recordErrorAttempt(attempts, 'agent-browser', error)
      }
    }
  }

  return throwAllFailed(attempts)
}
