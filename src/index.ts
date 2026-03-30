#!/usr/bin/env bun

import { runCli } from './cli/index'

export { parseCliArgs, runCli } from './cli/index'
export { fetchUrl } from './core/fetch-engine'
export { FetchError } from './core/types'
export type {
  AgentBrowserOptions,
  FetchAttempt,
  FetchMethod,
  FetchOptions,
  FetchResult,
  FetchStrategy,
  OutputMode,
  PluginConfig,
  StrategyMode,
  StructuredContent,
  StructuredHeading,
  StructuredLink,
  StructuredSection,
} from './core/types'
export { registerPlugin, listBuiltinPlugins } from './plugins/registry'
export type { FetchPlugin } from './plugins/types'

if (import.meta.main) {
  const exitCode = await runCli(Bun.argv.slice(2))
  if (exitCode !== 0) {
    process.exit(exitCode)
  }
}
