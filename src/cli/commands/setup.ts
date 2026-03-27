import {
  cancel,
  confirm,
  intro,
  isCancel,
  note,
  outro,
  text,
} from '@clack/prompts'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getDefaultConfigPath, getDefaultEnvPath } from '../../config/loader.js'
import { writeEnvFile } from '../../config/env-file.js'
import type { SetupCommand } from '../types.js'

const DEFAULT_CONFIG = {
  timeout: 30_000,
  enableFetch: true,
  enableJsdom: true,
  enablePlugins: true,
  enableAgentBrowser: true,
  strategyMode: 'auto',
  plugins: [],
}

const SETUP_CANCELED_MESSAGE = 'Setup canceled.'

const resolvePath = (value: string): string => {
  if (value === '~') {
    return process.env.HOME ?? value
  }

  if (value.startsWith('~/')) {
    return `${process.env.HOME ?? ''}/${value.slice(2)}`
  }

  return value
}

const buildEnvValues = (cdpPort: string, cdpLaunch: string): Record<string, string> => {
  const values: Record<string, string> = {
    AGENT_FETCH_CDP_PORT: cdpPort,
  }

  if (cdpLaunch) {
    values.AGENT_FETCH_CDP_LAUNCH = cdpLaunch
  }

  return values
}

const normalizePrompt = (value: unknown): string => {
  if (typeof value === 'string') {
    return value
  }
  return value === undefined || value === null ? '' : String(value)
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

const ensureInteractiveTerminal = (): void => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      'Interactive setup requires a TTY. Use `agent-fetch setup --no-input` in non-interactive environments.'
    )
  }
}

const writeConfigFile = async (
  configPath: string,
  overwrite: boolean,
  base?: Record<string, unknown>
): Promise<void> => {
  const exists = await fileExists(configPath)
  if (exists && !overwrite) {
    throw new Error(`${configPath} already exists. Re-run with --overwrite to replace it.`)
  }

  await mkdir(dirname(configPath), { recursive: true })
  const merged = {
    ...DEFAULT_CONFIG,
    ...base,
  }
  await writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8')
}

const confirmOverwriteIfNeeded = async (
  filePath: string,
  overwrite: boolean
): Promise<boolean> => {
  if (overwrite) {
    return true
  }

  if (!(await fileExists(filePath))) {
    return true
  }

  const result = await confirm({
    message: `${filePath} already exists. Overwrite it?`,
    initialValue: false,
  })

  return throwIfCanceled(result)
}

export const runSetupCommand = async (command: SetupCommand): Promise<void> => {
  const configPath = resolvePath(command.configPath ?? getDefaultConfigPath())
  const envFilePath = resolvePath(command.envFilePath ?? getDefaultEnvPath())

  if (command.noInput) {
    const cdpPort = (process.env.AGENT_FETCH_CDP_PORT ?? '').trim()
    const cdpLaunch = (process.env.AGENT_FETCH_CDP_LAUNCH ?? '').trim()

    if (!cdpPort) {
      throw new Error(
        'Missing environment value: AGENT_FETCH_CDP_PORT. Export it, then rerun `agent-fetch setup --no-input`.'
      )
    }

    const envValues = buildEnvValues(cdpPort, cdpLaunch)

    await writeEnvFile(envFilePath, envValues, command.overwrite)
    await writeConfigFile(configPath, command.overwrite)
    return
  }

  ensureInteractiveTerminal()

  intro('agent-fetch setup')
  note('This sets up authenticated browser fetch via CDP attach.', 'Setup flow')

  const envPort = (process.env.AGENT_FETCH_CDP_PORT ?? '').trim()
  const envLaunch = (process.env.AGENT_FETCH_CDP_LAUNCH ?? '').trim()

  const cdpPortInput = await text({
    message: envPort ? 'AGENT_FETCH_CDP_PORT (env default available)' : 'AGENT_FETCH_CDP_PORT',
    placeholder: '9222',
    initialValue: envPort || '9222',
    validate: (value) => {
      const normalized = normalizePrompt(value).trim()
      if (!/^\d+$/.test(normalized)) {
        return 'Enter a valid numeric CDP port, e.g. 9222.'
      }
      return undefined
    },
  })

  const cdpLaunchInput = await text({
    message: envLaunch
      ? 'AGENT_FETCH_CDP_LAUNCH (optional, env default available)'
      : 'AGENT_FETCH_CDP_LAUNCH (optional)',
    placeholder: 'open -na "Google Chrome" --args --remote-debugging-port=9222',
    initialValue: envLaunch,
  })

  const cdpPort = normalizePrompt(throwIfCanceled(cdpPortInput)).trim()
  const cdpLaunch = normalizePrompt(throwIfCanceled(cdpLaunchInput)).trim()

  const shouldWriteEnv = await confirmOverwriteIfNeeded(envFilePath, command.overwrite)
  if (!shouldWriteEnv) {
    outro('No changes made.')
    return
  }

  const shouldWriteConfig = await confirmOverwriteIfNeeded(configPath, command.overwrite)
  if (!shouldWriteConfig) {
    outro('No changes made.')
    return
  }

  const envValues = buildEnvValues(cdpPort, cdpLaunch)

  await writeEnvFile(envFilePath, envValues, true)
  await writeConfigFile(configPath, true)

  outro(`Saved setup to ${envFilePath} and ${configPath}`)
}
