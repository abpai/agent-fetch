import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempDirs: string[] = []
const originalStdinTty = process.stdin.isTTY
const originalStdoutTty = process.stdout.isTTY
const originalEnv = {
  AGENT_FETCH_TIMEOUT: process.env.AGENT_FETCH_TIMEOUT,
  AGENT_FETCH_ENABLE_FETCH: process.env.AGENT_FETCH_ENABLE_FETCH,
  AGENT_FETCH_ENABLE_JSDOM: process.env.AGENT_FETCH_ENABLE_JSDOM,
  AGENT_FETCH_ENABLE_PLUGINS: process.env.AGENT_FETCH_ENABLE_PLUGINS,
  AGENT_FETCH_ENABLE_AGENT_BROWSER: process.env.AGENT_FETCH_ENABLE_AGENT_BROWSER,
  AGENT_FETCH_STRATEGY_MODE: process.env.AGENT_FETCH_STRATEGY_MODE,
  AGENT_FETCH_PROFILE: process.env.AGENT_FETCH_PROFILE,
  AGENT_FETCH_AGENT_BROWSER_COMMAND: process.env.AGENT_FETCH_AGENT_BROWSER_COMMAND,
  AGENT_FETCH_OUTPUT_MODE: process.env.AGENT_FETCH_OUTPUT_MODE,
  AGENT_FETCH_USER_AGENT: process.env.AGENT_FETCH_USER_AGENT,
  AGENT_FETCH_WAIT_FOR_NETWORK_IDLE: process.env.AGENT_FETCH_WAIT_FOR_NETWORK_IDLE,
  AGENT_FETCH_MIN_HTML_LENGTH: process.env.AGENT_FETCH_MIN_HTML_LENGTH,
  AGENT_FETCH_MIN_MARKDOWN_LENGTH: process.env.AGENT_FETCH_MIN_MARKDOWN_LENGTH,
  AGENT_FETCH_MIN_WORD_COUNT: process.env.AGENT_FETCH_MIN_WORD_COUNT,
  AGENT_FETCH_BLOCKED_WORD_COUNT_THRESHOLD:
    process.env.AGENT_FETCH_BLOCKED_WORD_COUNT_THRESHOLD,
  SCRAPEDO_TOKEN: process.env.SCRAPEDO_TOKEN,
}

function setTTY(enabled: boolean) {
  Object.defineProperty(process.stdin, 'isTTY', { value: enabled, configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value: enabled, configurable: true })
}

async function importSetupModule() {
  return await import('./cli/commands/setup')
}

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

afterEach(async () => {
  mock.restore()
  restoreEnv()
  setTTY(Boolean(originalStdinTty && originalStdoutTty))
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

describe('agent-fetch setup wizard', () => {
  it('writes interactive fetch defaults, plugin config, and browser values to config', async () => {
    setTTY(true)
    const tempDir = await mkdtemp(join(tmpdir(), 'agent-fetch-setup-'))
    tempDirs.push(tempDir)
    const configPath = join(tempDir, 'config.json')

    const prompts = { confirm: 0, select: 0, text: 0 }

    mock.module('@clack/prompts', () => ({
      intro: () => {},
      outro: () => {},
      note: () => {},
      cancel: () => {},
      isCancel: () => false,
      select: async () => {
        prompts.select += 1
        return 'auto'
      },
      confirm: async () => {
        const answers = [true, true, true, true, true, true, true]
        return answers[prompts.confirm++] ?? true
      },
      text: async () => {
        const answers = [
          '45000',
          'scrape-token-123',
          'Agent Fetch Test UA',
          '120',
          '80',
          '20',
          '10',
          '~/.agent-browser/profiles/test',
        ]
        return answers[prompts.text++] ?? ''
      },
    }))

    const { runSetupCommand } = await importSetupModule()
    await runSetupCommand({
      command: 'setup',
      configPath,
      noInput: false,
      overwrite: false,
    })

    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      timeout: number
      enableFetch: boolean
      enableJsdom: boolean
      enablePlugins: boolean
      enableAgentBrowser: boolean
      strategyMode: string
      waitForNetworkIdle: boolean
      userAgent: string
      minHtmlLength: number
      minMarkdownLength: number
      minWordCount: number
      blockedWordCountThreshold: number
      plugins: Array<{ type: string; token: string }>
      agentBrowser: { profile: string }
    }

    expect(config.timeout).toBe(45_000)
    expect(config.enableFetch).toBe(true)
    expect(config.enableJsdom).toBe(true)
    expect(config.enablePlugins).toBe(true)
    expect(config.enableAgentBrowser).toBe(true)
    expect(config.strategyMode).toBe('auto')
    expect(config.waitForNetworkIdle).toBe(true)
    expect(config.userAgent).toBe('Agent Fetch Test UA')
    expect(config.minHtmlLength).toBe(120)
    expect(config.minMarkdownLength).toBe(80)
    expect(config.minWordCount).toBe(20)
    expect(config.blockedWordCountThreshold).toBe(10)
    expect(config.plugins).toEqual([{ type: 'scrape-do', token: 'scrape-token-123' }])
    expect(config.agentBrowser).toEqual({
      profile: '~/.agent-browser/profiles/test',
    })
  })

  it('writes no-input config from Bun env defaults without requiring browser settings', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'agent-fetch-setup-'))
    tempDirs.push(tempDir)
    const configPath = join(tempDir, 'config.json')

    process.env.AGENT_FETCH_TIMEOUT = '15000'
    process.env.AGENT_FETCH_ENABLE_FETCH = 'false'
    process.env.AGENT_FETCH_ENABLE_JSDOM = 'true'
    process.env.AGENT_FETCH_ENABLE_PLUGINS = 'true'
    process.env.AGENT_FETCH_ENABLE_AGENT_BROWSER = 'false'
    process.env.AGENT_FETCH_STRATEGY_MODE = 'simple'
    process.env.AGENT_FETCH_OUTPUT_MODE = 'html'
    process.env.AGENT_FETCH_WAIT_FOR_NETWORK_IDLE = 'true'
    process.env.AGENT_FETCH_USER_AGENT = 'NoInput UA'
    process.env.AGENT_FETCH_MIN_HTML_LENGTH = '40'
    process.env.AGENT_FETCH_MIN_MARKDOWN_LENGTH = '25'
    process.env.AGENT_FETCH_MIN_WORD_COUNT = '12'
    process.env.AGENT_FETCH_BLOCKED_WORD_COUNT_THRESHOLD = '6'
    process.env.SCRAPEDO_TOKEN = 'env-scrape-token'
    delete process.env.AGENT_FETCH_PROFILE

    const { runSetupCommand } = await importSetupModule()
    await runSetupCommand({
      command: 'setup',
      configPath,
      noInput: true,
      overwrite: true,
    })

    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      timeout: number
      outputMode: string
      enableFetch: boolean
      enableJsdom: boolean
      enablePlugins: boolean
      enableAgentBrowser: boolean
      strategyMode: string
      waitForNetworkIdle: boolean
      userAgent: string
      minHtmlLength: number
      minMarkdownLength: number
      minWordCount: number
      blockedWordCountThreshold: number
      plugins: Array<{ type: string; token: string }>
    }

    expect(config.timeout).toBe(15_000)
    expect(config.outputMode).toBe('html')
    expect(config.enableFetch).toBe(false)
    expect(config.enableJsdom).toBe(true)
    expect(config.enablePlugins).toBe(true)
    expect(config.enableAgentBrowser).toBe(false)
    expect(config.strategyMode).toBe('simple')
    expect(config.waitForNetworkIdle).toBe(true)
    expect(config.userAgent).toBe('NoInput UA')
    expect(config.minHtmlLength).toBe(40)
    expect(config.minMarkdownLength).toBe(25)
    expect(config.minWordCount).toBe(12)
    expect(config.blockedWordCountThreshold).toBe(6)
    expect(config.plugins).toEqual([{ type: 'scrape-do', token: '${SCRAPEDO_TOKEN}' }])
  })

  it('writes agent-browser command for authenticated no-input setup when provided', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'agent-fetch-setup-'))
    tempDirs.push(tempDir)
    const configPath = join(tempDir, 'config.json')

    process.env.AGENT_FETCH_STRATEGY_MODE = 'authenticated'
    process.env.AGENT_FETCH_ENABLE_AGENT_BROWSER = 'true'
    process.env.AGENT_FETCH_PROFILE = '~/.agent-browser/profiles/auth'
    process.env.AGENT_FETCH_AGENT_BROWSER_COMMAND = 'agent-browser'

    const { runSetupCommand } = await importSetupModule()
    await runSetupCommand({
      command: 'setup',
      configPath,
      noInput: true,
      overwrite: true,
    })

    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      agentBrowser: { profile: string; command: string }
    }
    expect(config.agentBrowser).toEqual({
      profile: '~/.agent-browser/profiles/auth',
      command: 'agent-browser',
    })
  })

  it('preserves an existing agent-browser command during interactive setup', async () => {
    setTTY(true)
    const tempDir = await mkdtemp(join(tmpdir(), 'agent-fetch-setup-'))
    tempDirs.push(tempDir)
    const configPath = join(tempDir, 'config.json')

    await Bun.write(
      configPath,
      `${JSON.stringify(
        {
          agentBrowser: {
            profile: '~/.agent-browser/profiles/existing',
            command: 'agent-browser --sandbox',
          },
        },
        null,
        2,
      )}\n`,
    )

    mock.module('@clack/prompts', () => ({
      intro: () => {},
      outro: () => {},
      note: () => {},
      cancel: () => {},
      isCancel: () => false,
      select: async () => 'auto',
      confirm: (() => {
        const answers = [true, true, false, false, false, true]
        let index = 0
        return async () => answers[index++] ?? true
      })(),
      text: (() => {
        const answers = ['30000', '', '']
        let index = 0
        return async () => answers[index++] ?? ''
      })(),
    }))

    const { runSetupCommand } = await importSetupModule()
    await runSetupCommand({
      command: 'setup',
      configPath,
      noInput: false,
      overwrite: false,
    })

    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      agentBrowser: { command: string }
    }
    expect(config.agentBrowser.command).toBe('agent-browser --sandbox')
  })

  it('requires AGENT_FETCH_PROFILE for authenticated no-input setup', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'agent-fetch-setup-'))
    tempDirs.push(tempDir)

    process.env.AGENT_FETCH_STRATEGY_MODE = 'authenticated'
    process.env.AGENT_FETCH_ENABLE_AGENT_BROWSER = 'true'
    delete process.env.AGENT_FETCH_PROFILE

    const { runSetupCommand } = await importSetupModule()

    await expect(
      runSetupCommand({
        command: 'setup',
        configPath: join(tempDir, 'config.json'),
        noInput: true,
        overwrite: true,
      }),
    ).rejects.toThrow('Missing environment value: AGENT_FETCH_PROFILE')
  })

  it('throws without a TTY for interactive setup', async () => {
    setTTY(false)
    const { runSetupCommand } = await importSetupModule()

    await expect(
      runSetupCommand({
        command: 'setup',
        configPath: join(tmpdir(), 'unused-config.json'),
        noInput: false,
        overwrite: false,
      }),
    ).rejects.toThrow('Interactive setup requires a TTY.')
  })

  it('preserves existing thresholds when skipping that section', async () => {
    setTTY(true)
    const tempDir = await mkdtemp(join(tmpdir(), 'agent-fetch-setup-'))
    tempDirs.push(tempDir)
    const configPath = join(tempDir, 'config.json')

    await Bun.write(
      configPath,
      `${JSON.stringify(
        {
          timeout: 30_000,
          enableFetch: true,
          enableJsdom: true,
          enablePlugins: false,
          enableAgentBrowser: true,
          strategyMode: 'auto',
          minHtmlLength: 250,
          minMarkdownLength: 150,
          minWordCount: 35,
          blockedWordCountThreshold: 15,
          plugins: [],
        },
        null,
        2,
      )}\n`,
    )

    mock.module('@clack/prompts', () => ({
      intro: () => {},
      outro: () => {},
      note: () => {},
      cancel: () => {},
      isCancel: () => false,
      select: async () => 'auto',
      confirm: (() => {
        const answers = [true, true, false, true, false, true, true]
        let index = 0
        return async () => answers[index++] ?? true
      })(),
      text: (() => {
        const answers = ['30000', '', '']
        let index = 0
        return async () => answers[index++] ?? ''
      })(),
    }))

    const { runSetupCommand } = await importSetupModule()
    await runSetupCommand({
      command: 'setup',
      configPath,
      noInput: false,
      overwrite: false,
    })

    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      minHtmlLength: number
      minMarkdownLength: number
      minWordCount: number
      blockedWordCountThreshold: number
    }

    expect(config.minHtmlLength).toBe(250)
    expect(config.minMarkdownLength).toBe(150)
    expect(config.minWordCount).toBe(35)
    expect(config.blockedWordCountThreshold).toBe(15)
  })
})
