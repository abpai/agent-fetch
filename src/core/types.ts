export type FetchStrategy = 'fetch' | 'jsdom' | 'agent-browser' | (string & {})
export type FetchMethod = 'fetch' | 'jsdom' | 'agent-browser' | (string & {})
export type OutputMode = 'markdown' | 'primary' | 'html' | 'structured' | 'screenshot'

export interface StructuredHeading {
  level: number
  text: string
}

export interface StructuredSection {
  heading: string
  level: number
  content: string
}

export interface StructuredLink {
  text: string
  href: string
}

export interface StructuredContent {
  title: string
  description: string | null
  headings: StructuredHeading[]
  sections: StructuredSection[]
  links: StructuredLink[]
}

export interface FetchResult {
  url: string
  title: string
  author: string | null
  content: string
  outputMode: OutputMode
  screenshotPath: string | null
  markdown: string
  primaryMarkdown: string
  html: string
  structuredContent: StructuredContent | null
  wordCount: number
  fetchedAt: Date
  strategy: FetchStrategy
  attempts: FetchAttempt[]
}

export interface FetchAttempt {
  strategy: FetchStrategy
  ok: boolean
  reason?: string
  error?: string
  durationMs: number
}

export type StrategyMode = 'auto' | 'simple' | 'authenticated'

export interface FetchOptions {
  method?: FetchMethod
  outputMode?: OutputMode
  timeout?: number
  waitForNetworkIdle?: boolean
  userAgent?: string
  headers?: Record<string, string>
  enableFetch?: boolean
  enableJsdom?: boolean
  enablePlugins?: boolean
  enableAgentBrowser?: boolean
  strategyMode?: StrategyMode
  withCredentials?: boolean
  plugins?: PluginConfig[]
  fetchTimeout?: number
  jsdomTimeout?: number
  minHtmlLength?: number
  minMarkdownLength?: number
  minWordCount?: number
  blockedTextPatterns?: Array<string | RegExp>
  blockedWordCountThreshold?: number
  agentBrowser?: AgentBrowserOptions
  environment?: Record<string, string>
  onProgress?: (message: string) => void
}

export interface FetchEngineContext {
  timeoutMs: number
  headers: Record<string, string>
  options: FetchOptions
  environment: Record<string, string>
}

export interface AgentBrowserOptions {
  profile?: string
  command?: string
  headed?: boolean
}

export class FetchError extends Error {
  readonly attempts: FetchAttempt[]

  constructor(message: string, attempts: FetchAttempt[]) {
    super(message)
    this.name = 'FetchError'
    this.attempts = attempts
  }
}

export interface PluginConfig {
  type: string
  [key: string]: unknown
}
