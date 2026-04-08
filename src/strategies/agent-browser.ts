import { mkdtemp } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
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
  headed: boolean
  timeoutMs: number
}

const PROFILE_IGNORED_PATTERN = /--profile ignored: daemon already running/i

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

const ensureProfileApplied = (
  action: string,
  result: CommandResult,
  profile: string | undefined,
): void => {
  if (!profile) {
    return
  }

  if (PROFILE_IGNORED_PATTERN.test(result.stderr)) {
    throw new Error(
      `${action} failed: agent-browser ignored the requested profile because a browser daemon is already running with different options. Run \`agent-browser close\` and retry.`,
    )
  }
}

const runCheckedCommand = async (
  command: string,
  args: string[],
  timeoutMs: number,
  action: string,
  profile?: string,
  checkProfile = false,
): Promise<CommandResult> => {
  const result = await runCommand(command, args, timeoutMs)
  if (result.code !== 0) {
    commandFailed(action, result)
  }

  if (checkProfile) {
    ensureProfileApplied(action, result, profile)
  }

  return result
}

const expandTilde = (value: string): string => {
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return path.join(homedir(), value.slice(2))
  return value
}

const resolveProfile = (context: FetchEngineContext): string | undefined => {
  const raw =
    context.options.agentBrowser?.profile ||
    context.environment.AGENT_FETCH_PROFILE ||
    process.env.AGENT_FETCH_PROFILE

  return raw ? expandTilde(raw) : undefined
}

const buildCommandArgs = (workflow: BrowserWorkflow, args: string[]): string[] => {
  const commandArgs: string[] = []

  if (workflow.profile) {
    commandArgs.push('--profile', workflow.profile)
  }

  if (workflow.headed) {
    commandArgs.push('--headed')
  }

  commandArgs.push(...args)

  return commandArgs
}

const runWorkflowCommand = (
  workflow: BrowserWorkflow,
  args: string[],
  action: string,
  checkProfile = false,
): Promise<CommandResult> =>
  runCheckedCommand(
    workflow.command,
    buildCommandArgs(workflow, args),
    workflow.timeoutMs,
    action,
    workflow.profile,
    checkProfile,
  )

const isProfileIgnoredError = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.includes('agent-browser ignored the requested profile')

const closeBrowser = async (workflow: BrowserWorkflow): Promise<void> => {
  await runCommand(workflow.command, ['close'], workflow.timeoutMs)
}

const openPage = async (
  workflow: BrowserWorkflow,
  url: string,
  waitForNetworkIdle: boolean,
): Promise<void> => {
  try {
    await runWorkflowCommand(workflow, ['open', url], 'agent-browser open', true)
  } catch (error) {
    if (!isProfileIgnoredError(error)) {
      throw error
    }
    await closeBrowser(workflow)
    await runWorkflowCommand(workflow, ['open', url], 'agent-browser open', true)
  }

  const loadState = waitForNetworkIdle ? 'networkidle' : 'load'
  await runWorkflowCommand(workflow, ['wait', '--load', loadState], 'agent-browser wait')
}

const getHtml = async (workflow: BrowserWorkflow): Promise<string> => {
  const htmlResult = await runWorkflowCommand(
    workflow,
    ['get', 'html', 'body'],
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
  const result = await runWorkflowCommand(
    workflow,
    ['screenshot', '--full', '--json', screenshotPath],
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
  const headed = context.options.agentBrowser?.headed === true

  if (requireCredentials && !profile) {
    throw new Error(
      'Missing AGENT_FETCH_PROFILE for authenticated mode. Run `agent-fetch setup`, pass `--profile`, or set AGENT_FETCH_PROFILE.',
    )
  }

  return { command, timeoutMs, profile, headed }
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
