import { DEFAULT_TIMEOUT_MS } from '../core/http'
import type { FetchEngineContext } from '../core/types'
import { spawn } from 'node:child_process'

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

const runCommand = async (
  command: string,
  args: string[],
  timeoutMs: number,
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
  action: string,
): Promise<CommandResult> => {
  const result = await runCommand(command, args, timeoutMs)
  if (result.code !== 0) {
    commandFailed(action, result)
  }

  return result
}

const resolveProfile = (context: FetchEngineContext): string | undefined =>
  context.options.agentBrowser?.profile ||
  context.environment.AGENT_FETCH_PROFILE ||
  process.env.AGENT_FETCH_PROFILE

const buildCommandArgs = (
  profile: string | undefined,
  args: string[],
): string[] => {
  if (!profile) {
    return args
  }

  return ['--profile', profile, ...args]
}

const runWorkflow = async (
  command: string,
  profile: string | undefined,
  url: string,
  timeoutMs: number,
  waitForNetworkIdle: boolean,
): Promise<string> => {
  await runCheckedCommand(
    command,
    buildCommandArgs(profile, ['open', url]),
    timeoutMs,
    'agent-browser open',
  )

  const loadState = waitForNetworkIdle ? 'networkidle' : 'load'
  await runCheckedCommand(
    command,
    buildCommandArgs(profile, ['wait', '--load', loadState]),
    timeoutMs,
    'agent-browser wait',
  )

  const htmlResult = await runCheckedCommand(
    command,
    buildCommandArgs(profile, ['get', 'html', 'body']),
    timeoutMs,
    'agent-browser get html',
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
  requireCredentials: boolean,
): Promise<string> => {
  const command = context.options.agentBrowser?.command || 'agent-browser'
  const timeoutMs = context.options.timeout ?? DEFAULT_TIMEOUT_MS
  const profile = resolveProfile(context)?.trim() || undefined

  if (requireCredentials && !profile) {
    throw new Error(
      'Missing AGENT_FETCH_PROFILE for authenticated mode. Run `agent-fetch setup`, pass `--profile`, or set AGENT_FETCH_PROFILE.',
    )
  }

  const waitForNetworkIdle = context.options.waitForNetworkIdle ?? true
  return runWorkflow(command, profile, url, timeoutMs, waitForNetworkIdle)
}
