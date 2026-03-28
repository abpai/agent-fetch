import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { readEnvFile } from './env-file.js'
import type { AgentFetchConfig, RuntimeConfig } from './types.js'
import type { OutputMode } from '../core/types.js'

const LEGACY_CONFIG_FILES = ['.fetchrc.json', 'fetch.config.json']
const OUTPUT_MODES = ['markdown', 'primary', 'html', 'structured'] as const
const STRATEGY_MODES = ['auto', 'simple', 'authenticated'] as const

const DEFAULT_CONFIG_PATH = path.join(homedir(), '.config', 'agent-fetch', 'config.json')
const DEFAULT_ENV_PATH = path.join(homedir(), '.config', 'agent-fetch', '.env')

const toBoolean = (value: string | undefined): boolean | undefined => {
  if (value === undefined) {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false
  }
  return undefined
}

const toNumber = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

const toOutputMode = (value: string | undefined): OutputMode | undefined => {
  if (value && OUTPUT_MODES.includes(value as OutputMode)) {
    return value as OutputMode
  }

  return undefined
}

const buildEnvOverrides = (environment: Record<string, string>): AgentFetchConfig => {
  const strategyMode = environment.AGENT_FETCH_STRATEGY_MODE
  const normalizedMode = STRATEGY_MODES.find((mode) => mode === strategyMode)

  return {
    outputMode: toOutputMode(environment.AGENT_FETCH_OUTPUT_MODE),
    timeout: toNumber(environment.AGENT_FETCH_TIMEOUT),
    waitForNetworkIdle: toBoolean(environment.AGENT_FETCH_WAIT_FOR_NETWORK_IDLE),
    userAgent: environment.AGENT_FETCH_USER_AGENT,
    enableFetch: toBoolean(environment.AGENT_FETCH_ENABLE_FETCH),
    enableJsdom: toBoolean(environment.AGENT_FETCH_ENABLE_JSDOM),
    enablePlugins: toBoolean(environment.AGENT_FETCH_ENABLE_PLUGINS),
    enableAgentBrowser: toBoolean(environment.AGENT_FETCH_ENABLE_AGENT_BROWSER),
    strategyMode: normalizedMode,
    minHtmlLength: toNumber(environment.AGENT_FETCH_MIN_HTML_LENGTH),
    minMarkdownLength: toNumber(environment.AGENT_FETCH_MIN_MARKDOWN_LENGTH),
    minWordCount: toNumber(environment.AGENT_FETCH_MIN_WORD_COUNT),
    blockedWordCountThreshold: toNumber(
      environment.AGENT_FETCH_BLOCKED_WORD_COUNT_THRESHOLD,
    ),
    agentBrowser: {
      cdpPort: environment.AGENT_FETCH_CDP_PORT,
      cdpLaunch: environment.AGENT_FETCH_CDP_LAUNCH,
      command: environment.AGENT_FETCH_AGENT_BROWSER_COMMAND,
    },
  }
}

const mergeConfig = (...items: AgentFetchConfig[]): AgentFetchConfig => {
  const merged: AgentFetchConfig = {}

  for (const item of items) {
    for (const [key, value] of Object.entries(item)) {
      if (value === undefined) {
        continue
      }

      if (key === 'agentBrowser' && value && typeof value === 'object') {
        merged.agentBrowser = {
          ...merged.agentBrowser,
          ...(value as NonNullable<AgentFetchConfig['agentBrowser']>),
        }
      } else {
        ;(merged as Record<string, unknown>)[key] = value
      }
    }
  }

  return merged
}

const resolvePath = (target: string): string => {
  if (target === '~') {
    return homedir()
  }

  if (target.startsWith('~/')) {
    return path.resolve(homedir(), target.slice(2))
  }

  return path.resolve(target)
}

const findLegacyConfigPath = (): string | null => {
  const roots = [process.cwd(), homedir()]

  for (const root of roots) {
    for (const name of LEGACY_CONFIG_FILES) {
      const filePath = path.join(root, name)
      if (existsSync(filePath)) {
        return filePath
      }
    }
  }

  return null
}

const throwLegacyConfigError = (legacyPath: string): never => {
  throw new Error(
    `Legacy config file detected at ${legacyPath}. This project now requires agent-fetch config only. Move settings to ~/.config/agent-fetch/config.json and remove legacy files.`,
  )
}

const readJsonConfig = (filePath: string): AgentFetchConfig => {
  if (!existsSync(filePath)) {
    return {}
  }

  const raw = readFileSync(filePath, 'utf-8')
  const parsed = JSON.parse(raw) as AgentFetchConfig
  return {
    ...parsed,
    plugins: parsed.plugins ?? [],
  }
}

interface LoadRuntimeConfigOptions {
  configPath?: string
  envFilePath?: string
}

export const getDefaultConfigPath = (): string => DEFAULT_CONFIG_PATH
export const getDefaultEnvPath = (): string => DEFAULT_ENV_PATH

export const loadRuntimeConfig = async (
  options: LoadRuntimeConfigOptions = {},
): Promise<RuntimeConfig> => {
  const legacyPath = findLegacyConfigPath()
  if (legacyPath) {
    throwLegacyConfigError(legacyPath)
  }

  const configPath = resolvePath(
    options.configPath ?? process.env.AGENT_FETCH_CONFIG_PATH ?? DEFAULT_CONFIG_PATH,
  )

  const envFilePath = resolvePath(
    options.envFilePath ?? process.env.AGENT_FETCH_SHARED_ENV_PATH ?? DEFAULT_ENV_PATH,
  )

  const sharedEnv = await readEnvFile(envFilePath)
  const environment = {
    ...sharedEnv,
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
  }

  const fileConfig = readJsonConfig(configPath)
  const envConfig = buildEnvOverrides(environment)

  return {
    config: mergeConfig(fileConfig, envConfig),
    environment,
    configPath,
    sharedEnvPath: envFilePath,
  }
}
