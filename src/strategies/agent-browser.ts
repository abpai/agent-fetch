import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_TIMEOUT_MS } from '../core/http'
import type { FetchEngineContext } from '../core/types'
import { spawn } from 'node:child_process'

interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

interface BrowserWorkflow {
  command: string
  profile: string | undefined
  timeoutMs: number
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

const buildCommandArgs = (profile: string | undefined, args: string[]): string[] => {
  if (!profile) {
    return args
  }

  return ['--profile', profile, ...args]
}

const openPage = async (
  workflow: BrowserWorkflow,
  url: string,
  waitForNetworkIdle: boolean,
): Promise<void> => {
  await runCheckedCommand(
    workflow.command,
    buildCommandArgs(workflow.profile, ['open', url]),
    workflow.timeoutMs,
    'agent-browser open',
  )

  const loadState = waitForNetworkIdle ? 'networkidle' : 'load'
  await runCheckedCommand(
    workflow.command,
    buildCommandArgs(workflow.profile, ['wait', '--load', loadState]),
    workflow.timeoutMs,
    'agent-browser wait',
  )
}

const getHtml = async (workflow: BrowserWorkflow): Promise<string> => {
  const htmlResult = await runCheckedCommand(
    workflow.command,
    buildCommandArgs(workflow.profile, ['get', 'html', 'body']),
    workflow.timeoutMs,
    'agent-browser get html',
  )

  const html = htmlResult.stdout.trim()
  if (!html) {
    throw new Error('agent-browser returned empty HTML content')
  }

  return html
}

const tryGetHtml = async (workflow: BrowserWorkflow): Promise<string> => {
  try {
    return await getHtml(workflow)
  } catch {
    return ''
  }
}

const takeScreenshot = async (workflow: BrowserWorkflow): Promise<string> => {
  const screenshotDir = await mkdtemp(path.join(tmpdir(), 'agent-fetch-shot-'))
  const screenshotPath = path.join(screenshotDir, 'page.png')
  const result = await runCheckedCommand(
    workflow.command,
    buildCommandArgs(workflow.profile, [
      'screenshot',
      '--full',
      '--json',
      screenshotPath,
    ]),
    workflow.timeoutMs,
    'agent-browser screenshot',
  )

  const payload = JSON.parse(result.stdout) as {
    success?: boolean
    data?: { path?: string }
    error?: string | null
  }
  const resolvedPath = payload.data?.path?.trim()
  if (!payload.success || !resolvedPath) {
    throw new Error(payload.error || 'agent-browser screenshot returned no path')
  }

  return resolvedPath
}

const resolveWorkflow = (
  context: FetchEngineContext,
  requireCredentials: boolean,
): BrowserWorkflow => {
  const command = context.options.agentBrowser?.command || 'agent-browser'
  const timeoutMs = context.options.timeout ?? DEFAULT_TIMEOUT_MS
  const profile = resolveProfile(context)?.trim() || undefined

  if (requireCredentials && !profile) {
    throw new Error(
      'Missing AGENT_FETCH_PROFILE for authenticated mode. Run `agent-fetch setup`, pass `--profile`, or set AGENT_FETCH_PROFILE.',
    )
  }

  return { command, timeoutMs, profile }
}

export const runAgentBrowserStrategy = async (
  url: string,
  context: FetchEngineContext,
  requireCredentials: boolean,
): Promise<string> => {
  const workflow = resolveWorkflow(context, requireCredentials)
  const waitForNetworkIdle = context.options.waitForNetworkIdle ?? true
  await openPage(workflow, url, waitForNetworkIdle)
  return getHtml(workflow)
}

export const runAgentBrowserScreenshot = async (
  url: string,
  context: FetchEngineContext,
  requireCredentials: boolean,
): Promise<{ screenshotPath: string; html: string }> => {
  const workflow = resolveWorkflow(context, requireCredentials)
  const waitForNetworkIdle = context.options.waitForNetworkIdle ?? true

  await openPage(workflow, url, waitForNetworkIdle)
  const screenshotPath = await takeScreenshot(workflow)
  const html = await tryGetHtml(workflow)

  return { screenshotPath, html }
}
