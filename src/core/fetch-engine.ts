import { validateResult } from './acceptance'
import { extractFromHtml } from './extract'
import { buildHeaders, DEFAULT_TIMEOUT_MS } from './http'
import type {
  FetchAttempt,
  FetchMethod,
  FetchOptions,
  FetchResult,
  StrategyMode,
} from './types'
import { FetchError } from './types'
import { resolvePlugins } from '../plugins/registry'
import { runFetchStrategy } from '../strategies/fetch'
import { runJsdomStrategy } from '../strategies/jsdom'
import {
  runAgentBrowserScreenshot,
  runAgentBrowserStrategy,
} from '../strategies/agent-browser'

type TextOutputMode = Exclude<FetchResult['outputMode'], 'screenshot'>

const pickMode = (options: FetchOptions): StrategyMode => {
  if (options.withCredentials) {
    return 'authenticated'
  }

  return options.strategyMode ?? 'auto'
}

const normalizeMethod = (method: FetchMethod | undefined): FetchMethod | undefined =>
  method?.trim().toLowerCase().replaceAll('.', '-') || undefined

const isScreenshotMode = (options: FetchOptions): boolean =>
  options.outputMode === 'screenshot'

const toTextOutputMode = (options: FetchOptions): TextOutputMode => {
  return (
    isScreenshotMode(options) ? 'markdown' : (options.outputMode ?? 'markdown')
  ) as TextOutputMode
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

const throwMethodDisabled = (method: string): never => {
  throw new Error(`Method "${method}" is disabled by the current fetch options.`)
}

const buildScreenshotResult = async (
  url: string,
  strategy: FetchAttempt['strategy'],
  screenshotPath: string,
  html: string,
): Promise<FetchResult> => {
  if (!html.trim()) {
    return {
      url,
      title: '',
      author: null,
      content: screenshotPath,
      outputMode: 'screenshot',
      screenshotPath,
      markdown: '',
      primaryMarkdown: '',
      html: '',
      structuredContent: null,
      wordCount: 0,
      fetchedAt: new Date(),
      strategy,
      attempts: [],
    }
  }

  const extracted = await extractFromHtml(url, html, strategy, 'markdown')
  return {
    ...extracted,
    content: screenshotPath,
    outputMode: 'screenshot',
    screenshotPath,
  }
}

export const fetchUrl = async (
  url: string,
  options: FetchOptions = {},
): Promise<FetchResult> => {
  const attempts: FetchAttempt[] = []
  const mode = pickMode(options)
  const method = normalizeMethod(options.method)
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
  const outputMode = toTextOutputMode(options)

  if (isScreenshotMode(options) && method && method !== 'agent-browser') {
    throw new Error('Screenshot mode only supports method "agent-browser".')
  }

  if (isScreenshotMode(options) && !enableAgentBrowser) {
    throwMethodDisabled('agent-browser')
  }

  if (mode === 'authenticated' && method && method !== 'agent-browser') {
    throw new Error('Authenticated mode only supports method "agent-browser".')
  }

  const runExactFetch = async (): Promise<FetchResult> => {
    if (!enableFetch) {
      throwMethodDisabled('fetch')
    }

    try {
      const run = await timed(() => runFetchStrategy(url, context))
      const extracted = await extractFromHtml(url, run.value, 'fetch', outputMode)
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
    } catch (error) {
      if (error instanceof FetchError) {
        throw error
      }

      recordErrorAttempt(attempts, 'fetch', error)
    }

    return throwAllFailed(attempts)
  }

  const runExactJsdom = async (): Promise<FetchResult> => {
    if (!enableJsdom) {
      throwMethodDisabled('jsdom')
    }

    try {
      const html = await runFetchStrategy(url, context)
      const run = await timed(() => runJsdomStrategy(url, html, context))
      const extracted = await extractFromHtml(url, run.value, 'jsdom', outputMode)
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
      if (error instanceof FetchError) {
        throw error
      }

      recordErrorAttempt(attempts, 'jsdom', error)
    }

    return throwAllFailed(attempts)
  }

  const runExactPlugin = async (pluginType: string): Promise<FetchResult> => {
    if (!enablePlugins) {
      throwMethodDisabled(pluginType)
    }

    const pluginConfig = (options.plugins ?? []).find(
      (entry) => entry.type === pluginType,
    )
    if (!pluginConfig) {
      throw new Error(`No plugin config found for method "${pluginType}".`)
    }

    const resolvedPlugin = resolvePlugins([pluginConfig], environment)[0]
    if (!resolvedPlugin) {
      throw new Error(`No plugin implementation found for method "${pluginType}".`)
    }

    const { plugin, config } = resolvedPlugin

    try {
      const run = await timed(() =>
        plugin.fetch(url, config, {
          headers,
          timeout: timeoutMs,
          environment,
        }),
      )

      const extracted = await extractFromHtml(url, run.value, plugin.name, outputMode)
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
      if (error instanceof FetchError) {
        throw error
      }

      recordErrorAttempt(attempts, pluginType, error)
    }

    return throwAllFailed(attempts)
  }

  const runScreenshot = async (requireCredentials: boolean): Promise<FetchResult> => {
    if (!enableAgentBrowser) {
      throwMethodDisabled('agent-browser')
    }

    try {
      const run = await timed(() =>
        runAgentBrowserScreenshot(url, context, requireCredentials),
      )
      const result = await buildScreenshotResult(
        url,
        'agent-browser',
        run.value.screenshotPath,
        run.value.html,
      )
      attempts.push({ strategy: 'agent-browser', ok: true, durationMs: run.durationMs })
      return {
        ...result,
        attempts: attempts.map((attempt) => ({ ...attempt })),
      }
    } catch (error) {
      if (error instanceof FetchError) {
        throw error
      }

      recordErrorAttempt(attempts, 'agent-browser', error)
      if (requireCredentials) {
        return throwAuthenticatedFailure(attempts)
      }
      return throwAllFailed(attempts)
    }
  }

  const runAuthenticated = async (): Promise<FetchResult> => {
    if (isScreenshotMode(options)) {
      return runScreenshot(true)
    }

    try {
      const run = await timed(() => runAgentBrowserStrategy(url, context, true))
      const extracted = await extractFromHtml(url, run.value, 'agent-browser', outputMode)
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

  if (isScreenshotMode(options)) {
    return runScreenshot(false)
  }

  if (method) {
    if (method === 'fetch') {
      return runExactFetch()
    }
    if (method === 'jsdom') {
      return runExactJsdom()
    }
    if (method === 'agent-browser') {
      if (!enableAgentBrowser) {
        throwMethodDisabled('agent-browser')
      }

      try {
        const run = await timed(() => runAgentBrowserStrategy(url, context, false))
        const extracted = await extractFromHtml(
          url,
          run.value,
          'agent-browser',
          outputMode,
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
        if (error instanceof FetchError) {
          throw error
        }

        recordErrorAttempt(attempts, 'agent-browser', error)
      }

      return throwAllFailed(attempts)
    }

    return runExactPlugin(method)
  }

  let fetchedHtml: string | null = null

  if (enableFetch) {
    try {
      const run = await timed(() => runFetchStrategy(url, context))
      fetchedHtml = run.value
      const extracted = await extractFromHtml(url, run.value, 'fetch', outputMode)
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
      const extracted = await extractFromHtml(url, run.value, 'jsdom', outputMode)
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

          const extracted = await extractFromHtml(url, run.value, plugin.name, outputMode)
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
      const extracted = await extractFromHtml(url, run.value, 'agent-browser', outputMode)
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
