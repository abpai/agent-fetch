import type { AgentBrowserOptions, PluginConfig } from '../core/types.js'

export interface AgentFetchConfig {
  timeout?: number
  waitForNetworkIdle?: boolean
  userAgent?: string
  headers?: Record<string, string>
  enableFetch?: boolean
  enableJsdom?: boolean
  enablePlugins?: boolean
  enableAgentBrowser?: boolean
  strategyMode?: 'auto' | 'simple' | 'authenticated'
  plugins?: PluginConfig[]
  minHtmlLength?: number
  minMarkdownLength?: number
  minWordCount?: number
  blockedWordCountThreshold?: number
  blockedTextPatterns?: string[]
  agentBrowser?: AgentBrowserOptions
}

export interface RuntimeConfig {
  config: AgentFetchConfig
  environment: Record<string, string>
  configPath: string
  sharedEnvPath: string
}
