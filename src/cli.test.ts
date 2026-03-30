import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import { parseCliArgs, runCli } from './cli/index'

const originalEnv = {
  AGENT_FETCH_PROFILE: process.env.AGENT_FETCH_PROFILE,
  AGENT_FETCH_ENABLE_AGENT_BROWSER: process.env.AGENT_FETCH_ENABLE_AGENT_BROWSER,
  AGENT_FETCH_ENABLE_PLUGINS: process.env.AGENT_FETCH_ENABLE_PLUGINS,
  SCRAPEDO_TOKEN: process.env.SCRAPEDO_TOKEN,
}

async function importSetupModule() {
  return await import('./cli/commands/setup')
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
      '--method',
      'scrape.do',
      '--profile',
      '/tmp/profile',
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
      method: 'scrape-do',
      profile: '/tmp/profile',
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
      method: undefined,
      profile: undefined,
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

  it('rejects screenshot mode when agent-browser is disabled', async () => {
    const output: string[] = []
    const error: string[] = []

    const code = await runCli(
      ['fetch', 'https://example.com', '--mode', 'screenshot', '--no-agent-browser'],
      {
        output: (message) => output.push(message),
        error: (message) => error.push(message),
      },
    )

    expect(code).toBe(2)
    expect(output).toHaveLength(0)
    expect(error).toEqual(['`screenshot` mode requires agent-browser to be enabled.'])
  })

  it('rejects non-browser methods in screenshot mode', async () => {
    const output: string[] = []
    const error: string[] = []

    const code = await runCli(
      ['fetch', 'https://example.com', '--mode', 'screenshot', '--method', 'fetch'],
      {
        output: (message) => output.push(message),
        error: (message) => error.push(message),
      },
    )

    expect(code).toBe(2)
    expect(output).toHaveLength(0)
    expect(error).toEqual(['`screenshot` mode only supports `--method agent-browser`.'])
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

    process.env.AGENT_FETCH_ENABLE_AGENT_BROWSER = 'true'
    process.env.AGENT_FETCH_ENABLE_PLUGINS = 'false'
    process.env.AGENT_FETCH_PROFILE = '/tmp/test-profile'
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
