import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import { loadRuntimeConfig } from './loader'

const createdDirs: string[] = []
const originalCwd = process.cwd()

const makeTempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-fetch-loader-'))
  createdDirs.push(dir)
  return dir
}

afterEach(() => {
  process.chdir(originalCwd)
  delete process.env.AGENT_FETCH_TIMEOUT
  delete process.env.AGENT_FETCH_OUTPUT_MODE
  delete process.env.AGENT_FETCH_PROFILE
  delete process.env.SCRAPEDO_TOKEN
})

describe('runtime config loader', () => {
  it('merges config file and environment overrides', async () => {
    const dir = makeTempDir()
    const configPath = path.join(dir, 'agent-fetch.config.json')

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          timeout: 1000,
          enableJsdom: true,
          plugins: [{ type: 'scrape-do', token: '${SCRAPEDO_TOKEN}' }],
        },
        null,
        2,
      ),
    )

    process.env.SCRAPEDO_TOKEN = 'from-process-env'
    process.env.AGENT_FETCH_TIMEOUT = '3000'
    process.env.AGENT_FETCH_OUTPUT_MODE = 'structured'

    const runtime = await loadRuntimeConfig({ configPath })

    expect(runtime.config.timeout).toBe(3000)
    expect(runtime.config.outputMode).toBe('structured')
    expect(runtime.config.enableJsdom).toBe(true)
    expect(runtime.config.plugins).toHaveLength(1)
    expect(runtime.environment.SCRAPEDO_TOKEN).toBe('from-process-env')
  })

  it('throws hard error when legacy config file exists', async () => {
    const dir = makeTempDir()
    const legacyPath = path.join(dir, '.fetchrc.json')
    writeFileSync(legacyPath, '{}')

    process.chdir(dir)

    await expect(
      loadRuntimeConfig({
        configPath: path.join(dir, 'agent-fetch.config.json'),
      }),
    ).rejects.toThrow('Legacy config file detected')
  })

  it('adds config-based AGENT_FETCH_PROFILE to the runtime environment', async () => {
    const dir = makeTempDir()
    const configPath = path.join(dir, 'agent-fetch.config.json')

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          agentBrowser: {
            profile: '~/.agent-browser/profiles/work',
          },
        },
        null,
        2,
      ),
    )

    const runtime = await loadRuntimeConfig({ configPath })

    expect(runtime.config.agentBrowser?.profile).toBe('~/.agent-browser/profiles/work')
    expect(runtime.environment.AGENT_FETCH_PROFILE).toBe('~/.agent-browser/profiles/work')
  })
})
