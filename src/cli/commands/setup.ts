import {
  cancel,
  confirm,
  intro,
  isCancel,
  note,
  outro,
  select,
  text,
} from '@clack/prompts'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { readEnvFile, writeEnvFile } from '../../config/env-file'
import { getDefaultConfigPath, getDefaultEnvPath } from '../../config/loader'
import type { AgentFetchConfig } from '../../config/types'
import type { OutputMode, StrategyMode } from '../../core/types'
import type { SetupCommand } from '../types'

const DEFAULT_CONFIG: AgentFetchConfig = {
  timeout: 30_000,
  enableFetch: true,
  enableJsdom: true,
  enablePlugins: true,
  enableAgentBrowser: true,
  strategyMode: 'auto',
  plugins: [],
}

const DEFAULT_PROFILE_PATH = '~/.agent-browser/profiles/default'
const SETUP_CANCELED_MESSAGE = 'Setup canceled.'

interface SetupArtifacts {
  config: AgentFetchConfig
  envValues: Record<string, string>
}

const resolvePath = (value: string): string => {
  if (value === '~') {
    return process.env.HOME ?? value
  }

  if (value.startsWith('~/')) {
    return `${process.env.HOME ?? ''}/${value.slice(2)}`
  }

  return value
}

const buildEnvValues = (profile: string, command?: string): Record<string, string> => {
  const values: Record<string, string> = {}

  if (profile.trim()) {
    values.AGENT_FETCH_PROFILE = profile.trim()
  }

  if (command?.trim()) {
    values.AGENT_FETCH_AGENT_BROWSER_COMMAND = command.trim()
  }

  return values
}

const addEnvValue = (
  values: Record<string, string>,
  key: string,
  value: string | undefined,
): void => {
  const normalized = value?.trim()
  if (normalized) {
    values[key] = normalized
  }
}

const throwIfCanceled = <T>(result: T | symbol): T => {
  if (isCancel(result)) {
    cancel(SETUP_CANCELED_MESSAGE)
    throw new Error(SETUP_CANCELED_MESSAGE)
  }

  return result
}

const fileExists = async (targetPath: string): Promise<boolean> => {
  try {
    await stat(targetPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }

    throw error
  }
}

const readJsonConfigFile = async (configPath: string): Promise<AgentFetchConfig> => {
  try {
    const source = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(source) as AgentFetchConfig

    return {
      ...parsed,
      plugins: parsed.plugins ?? [],
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }

    throw error
  }
}

const parseBooleanEnv = (value: string | undefined): boolean | undefined => {
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

const parsePositiveInt = (value: string, label = 'value'): number => {
  const parsed = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`)
  }

  return parsed
}

const parseOptionalPositiveInt = (value: string, label = 'value'): number | undefined => {
  const normalized = value.trim()
  if (!normalized) {
    return undefined
  }

  return parsePositiveInt(normalized, label)
}

const parseStrategyMode = (value: string | undefined): StrategyMode | undefined => {
  if (!value) {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (
    normalized === 'auto' ||
    normalized === 'simple' ||
    normalized === 'authenticated'
  ) {
    return normalized
  }

  return undefined
}

const parseOutputMode = (value: string | undefined): OutputMode | undefined => {
  if (!value) {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (
    normalized === 'markdown' ||
    normalized === 'primary' ||
    normalized === 'html' ||
    normalized === 'structured' ||
    normalized === 'screenshot'
  ) {
    return normalized
  }

  return undefined
}

const envPositiveInt = (key: string): number | undefined => {
  const value = process.env[key]
  return value !== undefined ? parsePositiveInt(value, key) : undefined
}

const validateOptionalPositiveInt = (
  value: string,
  label: string,
): string | undefined => {
  try {
    parseOptionalPositiveInt(value, label)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : `Invalid ${label}.`
  }
}

const ensureInteractiveTerminal = (): void => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'Interactive setup requires a TTY. Use `agent-fetch setup --no-input` in non-interactive environments.',
    )
  }
}

const promptRequiredText = async (args: {
  message: string
  initialValue?: string
  placeholder?: string
  validate?: (value: string) => string | undefined
}): Promise<string> => {
  const value = await text({
    message: args.message,
    initialValue: args.initialValue,
    placeholder: args.placeholder,
    validate: args.validate ? (raw) => args.validate?.((raw ?? '').trim()) : undefined,
  })

  return throwIfCanceled(value).trim()
}

const promptOptionalText = async (args: {
  message: string
  initialValue?: string
  placeholder?: string
  validate?: (value: string) => string | undefined
}): Promise<string> => {
  const value = await text({
    message: args.message,
    initialValue: args.initialValue,
    placeholder: args.placeholder,
    validate: args.validate ? (raw) => args.validate?.(raw ?? '') : undefined,
  })

  return throwIfCanceled(value).trim()
}

const writeConfigFile = async (
  configPath: string,
  overwrite: boolean,
  base?: AgentFetchConfig,
): Promise<void> => {
  const exists = await fileExists(configPath)
  if (exists && !overwrite) {
    throw new Error(
      `${configPath} already exists. Re-run with --overwrite to replace it.`,
    )
  }

  await mkdir(dirname(configPath), { recursive: true })
  const merged = {
    ...DEFAULT_CONFIG,
    ...base,
  }
  await writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8')
}

const confirmOverwriteIfNeeded = async (
  filePaths: string[],
  overwrite: boolean,
): Promise<boolean> => {
  if (overwrite) {
    return true
  }

  const existingPaths: string[] = []
  for (const filePath of filePaths) {
    if (await fileExists(filePath)) {
      existingPaths.push(filePath)
    }
  }

  if (existingPaths.length === 0) {
    return true
  }

  const result = await confirm({
    message:
      existingPaths.length === 1
        ? `${existingPaths[0]} already exists. Overwrite setup files?`
        : 'Setup files already exist. Overwrite them?',
    initialValue: false,
  })

  return throwIfCanceled(result)
}

const getCurrentPluginToken = (environment: Record<string, string | undefined>): string =>
  environment.SCRAPEDO_TOKEN ?? process.env.SCRAPEDO_TOKEN ?? ''

const hasScrapeDoPlugin = (config: AgentFetchConfig): boolean =>
  (config.plugins ?? []).some((entry) => entry.type === 'scrape-do')

const buildArtifactsFromEnv = (): SetupArtifacts => {
  const strategyMode =
    parseStrategyMode(process.env.AGENT_FETCH_STRATEGY_MODE) ??
    DEFAULT_CONFIG.strategyMode!
  const enableFetch =
    parseBooleanEnv(process.env.AGENT_FETCH_ENABLE_FETCH) ?? DEFAULT_CONFIG.enableFetch!
  const enableJsdom =
    parseBooleanEnv(process.env.AGENT_FETCH_ENABLE_JSDOM) ?? DEFAULT_CONFIG.enableJsdom!
  const enablePlugins =
    parseBooleanEnv(process.env.AGENT_FETCH_ENABLE_PLUGINS) ??
    DEFAULT_CONFIG.enablePlugins!
  let enableAgentBrowser =
    parseBooleanEnv(process.env.AGENT_FETCH_ENABLE_AGENT_BROWSER) ??
    DEFAULT_CONFIG.enableAgentBrowser!

  if (strategyMode === 'authenticated') {
    enableAgentBrowser = true
  }

  const scrapeDoToken = getCurrentPluginToken(process.env)
  const config: AgentFetchConfig = {
    outputMode: parseOutputMode(process.env.AGENT_FETCH_OUTPUT_MODE),
    timeout:
      process.env.AGENT_FETCH_TIMEOUT !== undefined
        ? parsePositiveInt(process.env.AGENT_FETCH_TIMEOUT, 'AGENT_FETCH_TIMEOUT')
        : DEFAULT_CONFIG.timeout,
    waitForNetworkIdle: parseBooleanEnv(process.env.AGENT_FETCH_WAIT_FOR_NETWORK_IDLE),
    userAgent: process.env.AGENT_FETCH_USER_AGENT?.trim() || undefined,
    enableFetch,
    enableJsdom,
    enablePlugins,
    enableAgentBrowser,
    strategyMode,
    minHtmlLength: envPositiveInt('AGENT_FETCH_MIN_HTML_LENGTH'),
    minMarkdownLength: envPositiveInt('AGENT_FETCH_MIN_MARKDOWN_LENGTH'),
    minWordCount: envPositiveInt('AGENT_FETCH_MIN_WORD_COUNT'),
    blockedWordCountThreshold: envPositiveInt('AGENT_FETCH_BLOCKED_WORD_COUNT_THRESHOLD'),
    plugins:
      enablePlugins && scrapeDoToken
        ? [{ type: 'scrape-do', token: '${SCRAPEDO_TOKEN}' }]
        : [],
  }

  const envValues: Record<string, string> = {}
  if (enableAgentBrowser) {
    const profile = (process.env.AGENT_FETCH_PROFILE ?? '').trim()
    if (strategyMode === 'authenticated' && !profile) {
      throw new Error(
        'Missing environment value: AGENT_FETCH_PROFILE. Export it, then rerun `agent-fetch setup --no-input`.',
      )
    }

    Object.assign(
      envValues,
      buildEnvValues(profile, process.env.AGENT_FETCH_AGENT_BROWSER_COMMAND),
    )
  }

  if (enablePlugins && scrapeDoToken) {
    addEnvValue(envValues, 'SCRAPEDO_TOKEN', scrapeDoToken)
  }

  return { config, envValues }
}

export const runSetupCommand = async (command: SetupCommand): Promise<void> => {
  const configPath = resolvePath(command.configPath ?? getDefaultConfigPath())
  const envFilePath = resolvePath(command.envFilePath ?? getDefaultEnvPath())

  if (command.noInput) {
    const { config, envValues } = buildArtifactsFromEnv()

    await writeEnvFile(envFilePath, envValues, command.overwrite)
    await writeConfigFile(configPath, command.overwrite, config)
    return
  }

  ensureInteractiveTerminal()

  const existingConfig = await readJsonConfigFile(configPath)
  const existingEnv = await readEnvFile(envFilePath)
  const currentConfig: AgentFetchConfig = {
    ...DEFAULT_CONFIG,
    ...existingConfig,
    plugins: existingConfig.plugins ?? [],
  }

  intro('agent-fetch setup')
  note(
    'Configure fetch defaults, optional plugins, and authenticated browser access.',
    'Setup flow',
  )

  const strategyMode = throwIfCanceled(
    await select({
      message: 'Default strategy mode',
      initialValue: currentConfig.strategyMode ?? DEFAULT_CONFIG.strategyMode,
      options: [
        {
          value: 'auto',
          label: 'Auto',
          hint: 'Try cheap strategies first, then escalate.',
        },
        {
          value: 'simple',
          label: 'Simple',
          hint: 'Prefer unauthenticated fetch paths only.',
        },
        {
          value: 'authenticated',
          label: 'Authenticated',
          hint: 'Jump directly to agent-browser with configured credentials.',
        },
      ],
    }),
  ) as StrategyMode

  const timeout = parsePositiveInt(
    await promptRequiredText({
      message: 'Default timeout (ms)',
      initialValue: String(currentConfig.timeout ?? DEFAULT_CONFIG.timeout),
      validate: (value) =>
        value.length === 0
          ? 'Timeout is required.'
          : validateOptionalPositiveInt(value, 'Timeout'),
    }),
    'Timeout',
  )

  const enableFetch = throwIfCanceled(
    await confirm({
      message: 'Enable plain fetch by default?',
      initialValue: currentConfig.enableFetch ?? DEFAULT_CONFIG.enableFetch,
    }),
  ) as boolean

  const enableJsdom = throwIfCanceled(
    await confirm({
      message: 'Enable jsdom fallback by default?',
      initialValue: currentConfig.enableJsdom ?? DEFAULT_CONFIG.enableJsdom,
    }),
  ) as boolean

  const enablePlugins = throwIfCanceled(
    await confirm({
      message: 'Enable plugin fallbacks by default?',
      initialValue: currentConfig.enablePlugins ?? DEFAULT_CONFIG.enablePlugins,
    }),
  ) as boolean

  const configureScrapeDo = enablePlugins
    ? (throwIfCanceled(
        await confirm({
          message: 'Configure the built-in scrape.do plugin now?',
          initialValue: hasScrapeDoPlugin(currentConfig),
        }),
      ) as boolean)
    : false

  const scrapeDoToken = configureScrapeDo
    ? await promptOptionalText({
        message: 'SCRAPEDO_TOKEN',
        initialValue: getCurrentPluginToken(existingEnv),
        placeholder: 'Paste your scrape.do token',
      })
    : ''

  const waitForNetworkIdle = throwIfCanceled(
    await confirm({
      message: 'Wait for network idle before extracting content?',
      initialValue: currentConfig.waitForNetworkIdle ?? false,
    }),
  ) as boolean

  const customUserAgent = await promptOptionalText({
    message: 'Custom user agent (optional)',
    initialValue: currentConfig.userAgent ?? '',
    placeholder: 'Leave blank to use the default Bun fetch agent',
  })

  const configureThresholds = throwIfCanceled(
    await confirm({
      message: 'Configure content validation thresholds now?',
      initialValue:
        currentConfig.minHtmlLength !== undefined ||
        currentConfig.minMarkdownLength !== undefined ||
        currentConfig.minWordCount !== undefined ||
        currentConfig.blockedWordCountThreshold !== undefined,
    }),
  ) as boolean

  const promptThreshold = async (
    label: string,
    current: number | undefined,
  ): Promise<number | undefined> => {
    if (!configureThresholds) return current
    return parseOptionalPositiveInt(
      await promptOptionalText({
        message: `${label} (optional)`,
        initialValue: current === undefined ? '' : String(current),
        placeholder: 'Leave blank to use runtime defaults',
        validate: (value) => validateOptionalPositiveInt(value, label),
      }),
      label,
    )
  }

  const minHtmlLength = await promptThreshold(
    'Minimum HTML length',
    currentConfig.minHtmlLength,
  )
  const minMarkdownLength = await promptThreshold(
    'Minimum Markdown length',
    currentConfig.minMarkdownLength,
  )
  const minWordCount = await promptThreshold(
    'Minimum word count',
    currentConfig.minWordCount,
  )
  const blockedWordCountThreshold = await promptThreshold(
    'Blocked-page word threshold',
    currentConfig.blockedWordCountThreshold,
  )

  let enableAgentBrowser: boolean
  if (strategyMode === 'authenticated') {
    note(
      'Authenticated mode requires agent-browser, so that fallback will be enabled.',
      'Browser defaults',
    )
    enableAgentBrowser = true
  } else {
    enableAgentBrowser = throwIfCanceled(
      await confirm({
        message: 'Enable agent-browser fallback by default?',
        initialValue:
          currentConfig.enableAgentBrowser ?? DEFAULT_CONFIG.enableAgentBrowser,
      }),
    ) as boolean
  }

  const currentProfile =
    existingEnv.AGENT_FETCH_PROFILE ??
    process.env.AGENT_FETCH_PROFILE ??
    currentConfig.agentBrowser?.profile ??
    DEFAULT_PROFILE_PATH
  const currentAgentBrowserCommand =
    existingEnv.AGENT_FETCH_AGENT_BROWSER_COMMAND ??
    process.env.AGENT_FETCH_AGENT_BROWSER_COMMAND ??
    currentConfig.agentBrowser?.command

  const profile = enableAgentBrowser
    ? strategyMode === 'authenticated'
      ? await promptRequiredText({
          message:
            process.env.AGENT_FETCH_PROFILE || existingEnv.AGENT_FETCH_PROFILE
              ? 'AGENT_FETCH_PROFILE (current value available)'
              : 'AGENT_FETCH_PROFILE',
          placeholder: DEFAULT_PROFILE_PATH,
          initialValue: currentProfile,
          validate: (value) =>
            value.trim().length > 0 ? undefined : 'Profile path is required.',
        })
      : await promptOptionalText({
          message:
            process.env.AGENT_FETCH_PROFILE || existingEnv.AGENT_FETCH_PROFILE
              ? 'AGENT_FETCH_PROFILE (optional, current value available)'
              : 'AGENT_FETCH_PROFILE (optional)',
          placeholder: DEFAULT_PROFILE_PATH,
          initialValue: currentProfile,
        })
    : ''

  const shouldWriteFiles = await confirmOverwriteIfNeeded(
    [envFilePath, configPath],
    command.overwrite,
  )
  if (!shouldWriteFiles) {
    outro('No changes made.')
    return
  }

  const envValues: Record<string, string> = {}
  if (enableAgentBrowser) {
    Object.assign(envValues, buildEnvValues(profile, currentAgentBrowserCommand))
  }
  if (enablePlugins && scrapeDoToken) {
    addEnvValue(envValues, 'SCRAPEDO_TOKEN', scrapeDoToken)
  }

  const config: AgentFetchConfig = {
    timeout,
    waitForNetworkIdle,
    userAgent: customUserAgent || undefined,
    enableFetch,
    enableJsdom,
    enablePlugins,
    enableAgentBrowser,
    strategyMode,
    plugins:
      enablePlugins && scrapeDoToken
        ? [{ type: 'scrape-do', token: '${SCRAPEDO_TOKEN}' }]
        : [],
    minHtmlLength,
    minMarkdownLength,
    minWordCount,
    blockedWordCountThreshold,
  }

  await writeEnvFile(envFilePath, envValues, true)
  await writeConfigFile(configPath, true, config)

  outro(`Saved setup to ${envFilePath} and ${configPath}`)
}
