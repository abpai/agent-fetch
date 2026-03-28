import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import { parseCliArgs, runCli } from './cli/index.js'

const originalEnv = {
  AGENT_FETCH_CDP_PORT: process.env.AGENT_FETCH_CDP_PORT,
  AGENT_FETCH_CDP_LAUNCH: process.env.AGENT_FETCH_CDP_LAUNCH,
  AGENT_FETCH_ENABLE_AGENT_BROWSER: process.env.AGENT_FETCH_ENABLE_AGENT_BROWSER,
  AGENT_FETCH_ENABLE_PLUGINS: process.env.AGENT_FETCH_ENABLE_PLUGINS,
  SCRAPEDO_TOKEN: process.env.SCRAPEDO_TOKEN,
}

async function importSetupModule() {
  return await import('./cli/commands/setup.js')
}

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
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
      outputMode: undefined,
      noJsdom: true,
      noPlugins: true,
      noAgentBrowser: false,
      timeout: 5000,
      withCredentials: false,
      strategy: 'simple',
      debugAttempts: true,
    })
  })

  it('treats a bare URL as fetch shorthand', () => {
    const parsed = parseCliArgs([
      'https://example.com',
      '--json',
      '--strategy',
      'simple',
      '--mode',
      'html',
    ])

    expect(parsed).toEqual({
      command: 'fetch',
      url: 'https://example.com',
      json: true,
      configPath: undefined,
      outputMode: 'html',
      noJsdom: false,
      noPlugins: false,
      noAgentBrowser: false,
      timeout: undefined,
      withCredentials: false,
      strategy: 'simple',
      debugAttempts: false,
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
      [
        'fetch',
        'https://example.com',
        '--strategy',
        'authenticated',
        '--no-agent-browser',
      ],
      {
        output: (message) => output.push(message),
        error: (message) => error.push(message),
      },
    )

    expect(code).toBe(2)
    expect(output).toHaveLength(0)
    expect(error).toEqual([
      '`authenticated` mode cannot be combined with `--no-agent-browser`.',
    ])
  })

  it('applies fetch shorthand during CLI execution', async () => {
    const output: string[] = []
    const error: string[] = []

    const code = await runCli(
      ['https://example.com', '--strategy', 'authenticated', '--no-agent-browser'],
      {
        output: (message) => output.push(message),
        error: (message) => error.push(message),
      },
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
        2,
      ),
    )

    process.env.AGENT_FETCH_CDP_PORT = '9222'
    process.env.AGENT_FETCH_ENABLE_AGENT_BROWSER = 'true'
    process.env.AGENT_FETCH_ENABLE_PLUGINS = 'false'
    delete process.env.AGENT_FETCH_CDP_LAUNCH
    delete process.env.SCRAPEDO_TOKEN

    const { runSetupCommand } = await importSetupModule()

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
