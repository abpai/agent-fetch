import { loadRuntimeConfig } from '../../config/loader.js'
import { fetchUrl } from '../../core/fetch-engine.js'
import { FetchError } from '../../core/types.js'
import type { StrategyMode } from '../../core/types.js'
import type { FetchCommand } from '../types.js'

export interface FetchCommandDependencies {
  output: (message: string) => void
  error: (message: string) => void
}

const renderAttempt = (attempt: { strategy: string; ok: boolean; reason?: string; error?: string; durationMs: number }): string => {
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
  dependencies: FetchCommandDependencies
): Promise<number> => {
  try {
    let strategyMode: StrategyMode = command.strategy
    if (command.withCredentials || command.strategy === 'authenticated') {
      strategyMode = 'authenticated'
    }

    if (strategyMode === 'authenticated' && command.noAgentBrowser) {
      dependencies.error(
        '`authenticated` mode cannot be combined with `--no-agent-browser`.'
      )
      return 2
    }

    const runtime = await loadRuntimeConfig({ configPath: command.configPath })

    const options = {
      ...runtime.config,
      enableJsdom: command.noJsdom ? false : (runtime.config.enableJsdom ?? true),
      enablePlugins: command.noPlugins ? false : (runtime.config.enablePlugins ?? true),
      enableAgentBrowser: command.noAgentBrowser ? false : (runtime.config.enableAgentBrowser ?? true),
      timeout: command.timeout ?? runtime.config.timeout,
      withCredentials: command.withCredentials,
      strategyMode,
      plugins: runtime.config.plugins ?? [],
      blockedTextPatterns: runtime.config.blockedTextPatterns,
      environment: runtime.environment,
    }

    const result = await fetchUrl(command.url, options)

    if (command.json) {
      dependencies.output(
        JSON.stringify(
          {
            url: result.url,
            title: result.title,
            author: result.author,
            markdown: result.markdown,
            html: result.html,
            wordCount: result.wordCount,
            strategy: result.strategy,
            fetchedAt: result.fetchedAt.toISOString(),
            attempts: result.attempts,
          },
          null,
          2
        )
      )
    } else {
      dependencies.output(result.markdown)
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
