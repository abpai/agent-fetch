import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'
import { loadRuntimeConfig } from './loader.js'

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
})

describe('runtime config loader', () => {
  it('merges config file and environment overrides', async () => {
    const dir = makeTempDir()
    const configPath = path.join(dir, 'agent-fetch.config.json')
    const envPath = path.join(dir, '.env')

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

    writeFileSync(envPath, 'SCRAPEDO_TOKEN=from-env-file\nAGENT_FETCH_TIMEOUT=2000\n')
    process.env.AGENT_FETCH_TIMEOUT = '3000'

    const runtime = await loadRuntimeConfig({
      configPath,
      envFilePath: envPath,
    })

    expect(runtime.config.timeout).toBe(3000)
    expect(runtime.config.enableJsdom).toBe(true)
    expect(runtime.config.plugins).toHaveLength(1)
    expect(runtime.environment.SCRAPEDO_TOKEN).toBe('from-env-file')
  })

  it('throws hard error when legacy config file exists', async () => {
    const dir = makeTempDir()
    const legacyPath = path.join(dir, '.fetchrc.json')
    writeFileSync(legacyPath, '{}')

    process.chdir(dir)

    await expect(
      loadRuntimeConfig({
        configPath: path.join(dir, 'agent-fetch.config.json'),
        envFilePath: path.join(dir, '.env'),
      }),
    ).rejects.toThrow('Legacy config file detected')
  })
})
