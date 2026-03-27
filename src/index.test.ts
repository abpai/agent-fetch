import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { fetchUrl, FetchError, registerPlugin } from './index.js'

const BASE_HTML = `<!DOCTYPE html><html><head><title>Example Domain</title></head><body><article><h1>Example Domain</h1><p>This domain is for use in illustrative examples in documents.</p></article></body></html>`

const AGENT_BROWSER_HTML = `<!DOCTYPE html><html><head><title>Authenticated Page</title></head><body><article><h1>Authenticated Page</h1><p>Authenticated content from agent-browser.</p></article></body></html>`

let server: ReturnType<typeof createServer>
let baseUrl: string
let mockAgentBrowserPath: string

const createMockAgentBrowser = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-fetch-test-'))
  const scriptPath = path.join(dir, 'mock-agent-browser.mjs')
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2)

if (process.env.MOCK_AGENT_BROWSER_FAIL_OPEN === '1' && args.includes('open')) {
  console.error('simulated open failure')
  process.exit(1)
}

if (args.includes('get') && args.includes('html')) {
  process.stdout.write(${JSON.stringify(AGENT_BROWSER_HTML)})
  process.exit(0)
}

process.exit(0)
`

  writeFileSync(scriptPath, script, 'utf-8')
  chmodSync(scriptPath, 0o755)
  return scriptPath
}

const largeWordBlob = (count: number): string => Array.from({ length: count }, () => 'word').join(' ')

describe('agent-fetch engine', () => {
  beforeAll(() => {
    mockAgentBrowserPath = createMockAgentBrowser()

    server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(BASE_HTML)
    })

    return new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address()
        const port = typeof addr === 'object' && addr ? addr.port : 0
        baseUrl = `http://127.0.0.1:${port}`
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('uses simple fetch for static pages', async () => {
    const result = await fetchUrl(baseUrl, {
      strategyMode: 'simple',
      enableAgentBrowser: false,
      enableJsdom: false,
      enablePlugins: false,
      minHtmlLength: 20,
      minWordCount: 5,
      minMarkdownLength: 20,
    })

    expect(result.strategy).toBe('fetch')
    expect(result.title).toBe('Example Domain')
    expect(result.attempts).toHaveLength(1)
    expect(result.attempts[0].strategy).toBe('fetch')
    expect(result.attempts[0].ok).toBe(true)
  })

  it('uses plugin fallback after fetch and jsdom fail thresholds', async () => {
    registerPlugin('mock-threshold', {
      name: 'mock-threshold',
      async fetch() {
        return `<!DOCTYPE html><html><head><title>Plugin Page</title></head><body><article>${largeWordBlob(1500)}</article></body></html>`
      },
    })

    const result = await fetchUrl(baseUrl, {
      strategyMode: 'auto',
      enableAgentBrowser: false,
      plugins: [{ type: 'mock-threshold' }],
      minWordCount: 1000,
      minMarkdownLength: 20,
    })

    expect(result.strategy).toBe('mock-threshold')
    expect(result.attempts[0].strategy).toBe('fetch')
    expect(result.attempts[0].ok).toBe(false)
    expect(result.attempts[1].strategy).toBe('jsdom')
    expect(result.attempts[1].ok).toBe(false)
    expect(result.attempts[2].strategy).toBe('mock-threshold')
    expect(result.attempts[2].ok).toBe(true)
  })

  it('jumps directly to agent-browser in authenticated mode', async () => {
    const result = await fetchUrl(baseUrl, {
      withCredentials: true,
      enableFetch: true,
      enableJsdom: true,
      enablePlugins: true,
      plugins: [{ type: 'scrape-do', token: 'unused' }],
      agentBrowser: {
        cdpPort: '9222',
        command: mockAgentBrowserPath,
      },
      minHtmlLength: 20,
      minWordCount: 3,
      minMarkdownLength: 20,
    })

    expect(result.strategy).toBe('agent-browser')
    expect(result.attempts).toHaveLength(1)
    expect(result.attempts[0].strategy).toBe('agent-browser')
    expect(result.attempts[0].ok).toBe(true)
  })

  it('fails fast when authenticated mode agent-browser fails', async () => {
    process.env.MOCK_AGENT_BROWSER_FAIL_OPEN = '1'

    try {
      await fetchUrl(baseUrl, {
        withCredentials: true,
        agentBrowser: {
          cdpPort: '9222',
          command: mockAgentBrowserPath,
        },
      })
      throw new Error('Expected fetchUrl to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(FetchError)
      const fetchError = error as FetchError
      expect(fetchError.message).toContain('Authenticated fetch failed')
      expect(fetchError.attempts).toHaveLength(1)
      expect(fetchError.attempts[0].strategy).toBe('agent-browser')
      expect(fetchError.attempts[0].ok).toBe(false)
    } finally {
      delete process.env.MOCK_AGENT_BROWSER_FAIL_OPEN
    }
  })
})
