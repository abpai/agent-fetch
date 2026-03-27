import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import { parseCliArgs, runCli } from './cli/index.js'
import { runSetupCommand } from './cli/commands/setup.js'

const originalEnv = {
  AGENT_FETCH_CDP_PORT: process.env.AGENT_FETCH_CDP_PORT,
  AGENT_FETCH_CDP_LAUNCH: process.env.AGENT_FETCH_CDP_LAUNCH,
}

afterEach(() => {
  if (originalEnv.AGENT_FETCH_CDP_PORT === undefined) {
    delete process.env.AGENT_FETCH_CDP_PORT
  } else {
    process.env.AGENT_FETCH_CDP_PORT = originalEnv.AGENT_FETCH_CDP_PORT
  }

  if (originalEnv.AGENT_FETCH_CDP_LAUNCH === undefined) {
    delete process.env.AGENT_FETCH_CDP_LAUNCH
  } else {
    process.env.AGENT_FETCH_CDP_LAUNCH = originalEnv.AGENT_FETCH_CDP_LAUNCH
  }
})

describe('agent-fetch CLI parsing', () => {
  it('parses fetch command with flags', () => {
    const parsed = parseCliArgs([
      'fetch',
      'https://example.com',
      '--json',
      '--no-jsdom',
      '--no-plugins',
      '--timeout',
      '5000',
      '--strategy',
      'simple',
      '--debug-attempts',
    ])

    expect(parsed).toEqual({
      command: 'fetch',
      url: 'https://example.com',
      json: true,
      configPath: undefined,
      noJsdom: true,
      noPlugins: true,
      noAgentBrowser: false,
      timeout: 5000,
      withCredentials: false,
      strategy: 'simple',
      debugAttempts: true,
    })
  })

  it('parses setup command in non-interactive mode', () => {
    const parsed = parseCliArgs(['setup', '--no-input', '--overwrite'])

    expect(parsed).toEqual({
      command: 'setup',
      configPath: undefined,
      envFilePath: undefined,
      noInput: true,
      overwrite: true,
    })
  })

  it('parses plugins list command', () => {
    const parsed = parseCliArgs(['plugins', 'list', '--json'])

    expect(parsed).toEqual({
      command: 'plugins-list',
      json: true,
    })
  })
})

describe('agent-fetch CLI run', () => {
  it('prints help and exits 0 with no args', async () => {
    const output: string[] = []
    const error: string[] = []

    const code = await runCli([], {
      output: (message) => output.push(message),
      error: (message) => error.push(message),
    })

    expect(code).toBe(0)
    expect(output.join('\n')).toContain('agent-fetch')
    expect(error).toHaveLength(0)
  })

  it('rejects authenticated mode when agent-browser is disabled', async () => {
    const output: string[] = []
    const error: string[] = []

    const code = await runCli(
      ['fetch', 'https://example.com', '--strategy', 'authenticated', '--no-agent-browser'],
      {
        output: (message) => output.push(message),
        error: (message) => error.push(message),
      }
    )

    expect(code).toBe(2)
    expect(output).toHaveLength(0)
    expect(error).toEqual([
      '`authenticated` mode cannot be combined with `--no-agent-browser`.',
    ])
  })
})

describe('agent-fetch setup', () => {
  it('replaces existing config when overwrite is enabled', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'agent-fetch-setup-'))
    const configPath = path.join(dir, 'config.json')
    const envFilePath = path.join(dir, '.env')

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          timeout: 1234,
          plugins: [{ type: 'scrape-do', token: 'stale-token' }],
        },
        null,
        2
      )
    )

    process.env.AGENT_FETCH_CDP_PORT = '9222'
    delete process.env.AGENT_FETCH_CDP_LAUNCH

    await runSetupCommand({
      command: 'setup',
      configPath,
      envFilePath,
      noInput: true,
      overwrite: true,
    })

    const writtenConfig = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      timeout: number
      plugins: Array<{ type: string; token?: string }>
    }

    expect(writtenConfig.timeout).toBe(30_000)
    expect(writtenConfig.plugins).toEqual([])
  })
})
