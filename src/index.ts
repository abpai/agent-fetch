#!/usr/bin/env bun

import { runCli } from './cli/index.js'

export { parseCliArgs, runCli } from './cli/index.js'
export { fetchUrl } from './core/fetch-engine.js'
export { FetchError } from './core/types.js'
export type {
  AgentBrowserOptions,
  FetchAttempt,
  FetchOptions,
  FetchResult,
  FetchStrategy,
  PluginConfig,
  StrategyMode,
} from './core/types.js'
export { registerPlugin, listBuiltinPlugins } from './plugins/registry.js'
export type { FetchPlugin } from './plugins/types.js'

if (import.meta.main) {
  const exitCode = await runCli(Bun.argv.slice(2))
  if (exitCode !== 0) {
    process.exit(exitCode)
  }
}
