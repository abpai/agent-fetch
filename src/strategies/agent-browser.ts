import { spawn } from 'node:child_process'
import { DEFAULT_TIMEOUT_MS } from '../core/http.js'
import type { FetchEngineContext } from '../core/types.js'

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

const runCommand = async (
  command: string,
  args: string[],
  timeoutMs: number
): Promise<CommandResult> => {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM')
    }, timeoutMs)

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    proc.on('close', (code) => {
      clearTimeout(timeout)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

const runLaunchCommand = (launchCommand: string): void => {
  const shell = process.env.SHELL || 'sh'
  const launched = spawn(shell, ['-lc', launchCommand], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  })
  launched.unref()
}

const commandFailed = (action: string, result: CommandResult): never => {
  const stderr = result.stderr.trim()
  const stdout = result.stdout.trim()
  const detail = stderr || stdout || `exit code ${result.code}`
  throw new Error(`${action} failed: ${detail}`)
}

const runCheckedCommand = async (
  command: string,
  args: string[],
  timeoutMs: number,
  action: string
): Promise<CommandResult> => {
  const result = await runCommand(command, args, timeoutMs)
  if (result.code !== 0) {
    commandFailed(action, result)
  }

  return result
}

const resolveConfiguredPort = (context: FetchEngineContext): string | undefined =>
  context.options.agentBrowser?.cdpPort ||
  context.environment.AGENT_FETCH_CDP_PORT ||
  process.env.AGENT_FETCH_CDP_PORT

const resolveLaunchCommand = (context: FetchEngineContext): string | undefined =>
  context.options.agentBrowser?.cdpLaunch ||
  context.environment.AGENT_FETCH_CDP_LAUNCH ||
  process.env.AGENT_FETCH_CDP_LAUNCH

const parsePort = (rawPort: string): string => {
  const normalized = rawPort.trim()
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Invalid AGENT_FETCH_CDP_PORT value: ${rawPort}`)
  }
  return normalized
}

const runWorkflow = async (
  command: string,
  cdpPort: string,
  url: string,
  timeoutMs: number
): Promise<string> => {
  await runCheckedCommand(
    command,
    ['--cdp', cdpPort, 'open', url],
    timeoutMs,
    'agent-browser open'
  )

  await runCheckedCommand(
    command,
    ['--cdp', cdpPort, 'wait', '--load', 'networkidle'],
    timeoutMs,
    'agent-browser wait'
  )

  const htmlResult = await runCheckedCommand(
    command,
    ['--cdp', cdpPort, 'get', 'html', 'body'],
    timeoutMs,
    'agent-browser get html'
  )

  const html = htmlResult.stdout.trim()
  if (!html) {
    throw new Error('agent-browser returned empty HTML content')
  }

  return html
}

export const runAgentBrowserStrategy = async (
  url: string,
  context: FetchEngineContext,
  requireCredentials: boolean
): Promise<string> => {
  const command = context.options.agentBrowser?.command || 'agent-browser'
  const timeoutMs = context.options.timeout ?? DEFAULT_TIMEOUT_MS
  const configuredPort = resolveConfiguredPort(context)

  if (!configuredPort) {
    if (requireCredentials) {
      throw new Error(
        'Missing AGENT_FETCH_CDP_PORT for authenticated mode. Run `agent-fetch setup` or set AGENT_FETCH_CDP_PORT.'
      )
    }

    throw new Error('agent-browser credentials not configured')
  }

  const cdpPort = parsePort(configuredPort)

  try {
    return await runWorkflow(command, cdpPort, url, timeoutMs)
  } catch (error) {
    const cdpLaunch = resolveLaunchCommand(context)

    if (!cdpLaunch) {
      throw error
    }

    runLaunchCommand(cdpLaunch)
    await new Promise((resolve) => setTimeout(resolve, 2_500))

    return runWorkflow(command, cdpPort, url, timeoutMs)
  }
}
