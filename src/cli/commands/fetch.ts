import { loadRuntimeConfig } from '../../config/loader'
import { fetchUrl } from '../../core/fetch-engine'
import { serializeFetchResult } from '../../core/serialize'
import { FetchError } from '../../core/types'
import type { OutputMode, StrategyMode } from '../../core/types'
import type { FetchCommand } from '../types'

interface FetchCommandDependencies {
  output: (message: string) => void
  error: (message: string) => void
}

const resolveStrategyMode = (command: FetchCommand): StrategyMode =>
  command.withCredentials || command.strategy === 'authenticated'
    ? 'authenticated'
    : command.strategy

const resolveOutputMode = (
  command: FetchCommand,
  runtimeOutputMode: OutputMode | undefined,
): OutputMode => command.outputMode ?? runtimeOutputMode ?? 'markdown'

const isPluginMethod = (method: string): boolean =>
  method !== 'fetch' && method !== 'jsdom' && method !== 'agent-browser'

const renderAttempt = (attempt: {
  strategy: string
  ok: boolean
  reason?: string
  error?: string
  durationMs: number
}): string => {
  if (attempt.ok) {
    return `${attempt.strategy}: ok (${attempt.durationMs}ms)`
  }

  if (attempt.reason) {
    return `${attempt.strategy}: ${attempt.reason} (${attempt.durationMs}ms)`
  }

  return `${attempt.strategy}: ${attempt.error ?? 'unknown error'} (${attempt.durationMs}ms)`
}

export const runFetchCommand = async (
  command: FetchCommand,
  dependencies: FetchCommandDependencies,
): Promise<number> => {
  try {
    const strategyMode = resolveStrategyMode(command)
    const method = command.method

    if (strategyMode === 'authenticated' && command.noAgentBrowser) {
      dependencies.error(
        '`authenticated` mode cannot be combined with `--no-agent-browser`.',
      )
      return 2
    }

    const runtime = await loadRuntimeConfig({ configPath: command.configPath })
    const outputMode = resolveOutputMode(command, runtime.config.outputMode)

    if (outputMode === 'screenshot' && command.noAgentBrowser) {
      dependencies.error('`screenshot` mode requires agent-browser to be enabled.')
      return 2
    }

    if (outputMode === 'screenshot' && method && method !== 'agent-browser') {
      dependencies.error('`screenshot` mode only supports `--method agent-browser`.')
      return 2
    }

    if (method === 'jsdom' && command.noJsdom) {
      dependencies.error('`--method jsdom` cannot be combined with `--no-jsdom`.')
      return 2
    }

    if (method === 'agent-browser' && command.noAgentBrowser) {
      dependencies.error(
        '`--method agent-browser` cannot be combined with `--no-agent-browser`.',
      )
      return 2
    }

    if (method && isPluginMethod(method) && command.noPlugins) {
      dependencies.error(
        '`--method` for a plugin cannot be combined with `--no-plugins`.',
      )
      return 2
    }

    if (command.withCredentials && method && method !== 'agent-browser') {
      dependencies.error('`--with-credentials` only supports `--method agent-browser`.')
      return 2
    }

    if (strategyMode === 'authenticated' && method && method !== 'agent-browser') {
      dependencies.error(
        '`--strategy authenticated` only supports `--method agent-browser`.',
      )
      return 2
    }

    const options = {
      ...runtime.config,
      method,
      outputMode,
      enableJsdom: command.noJsdom ? false : (runtime.config.enableJsdom ?? true),
      enablePlugins: command.noPlugins ? false : (runtime.config.enablePlugins ?? true),
      enableAgentBrowser: command.noAgentBrowser
        ? false
        : (runtime.config.enableAgentBrowser ?? true),
      timeout: command.timeout ?? runtime.config.timeout,
      withCredentials: command.withCredentials,
      strategyMode,
      plugins: runtime.config.plugins ?? [],
      blockedTextPatterns: runtime.config.blockedTextPatterns,
      environment: runtime.environment,
      agentBrowser: {
        ...runtime.config.agentBrowser,
        ...(command.profile ? { profile: command.profile } : {}),
      },
    }

    const result = await fetchUrl(command.url, options)

    if (command.json) {
      dependencies.output(JSON.stringify(serializeFetchResult(result), null, 2))
    } else {
      dependencies.output(result.content)
    }

    if (command.debugAttempts) {
      for (const attempt of result.attempts) {
        dependencies.error(renderAttempt(attempt))
      }
    }

    return 0
  } catch (error) {
    if (error instanceof FetchError) {
      dependencies.error(`agent-fetch failed: ${error.message}`)
      for (const attempt of error.attempts) {
        dependencies.error(`  ${renderAttempt(attempt)}`)
      }
      return 1
    }

    dependencies.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}
