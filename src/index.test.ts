import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { fetchUrl, FetchError, registerPlugin } from './index'

const BASE_HTML = `<!DOCTYPE html><html><head><title>Example Domain</title></head><body><article><h1>Example Domain</h1><p>This domain is for use in illustrative examples in documents.</p></article></body></html>`

const AGENT_BROWSER_HTML = `<!DOCTYPE html><html><head><title>Authenticated Page</title></head><body><article><h1>Authenticated Page</h1><p>Authenticated content from agent-browser.</p></article></body></html>`

const PORTAL_HTML = `<!DOCTYPE html><html><head><title>Portal Page</title><meta name="description" content="Portal description" /></head><body><header><nav><a href="/news">News</a></nav></header><main><section><h2><a href="/news">News</a></h2><article><h3><a href="/news/hero">Hero headline</a></h3><p>Lead story summary for homepage readers.</p></article></section><section><h2><a href="/markets">Markets</a></h2><table><thead><tr><th>Name</th><th>Last</th></tr></thead><tbody><tr><td>Dow Jones</td><td>45,960.11</td></tr></tbody></table></section></main><footer><p>Risk Disclosure</p><p>Fusion Media Limited. All Rights Reserved.</p></footer></body></html>`

let server: ReturnType<typeof createServer>
let baseUrl: string
let mockAgentBrowserPath: string

const createMockAgentBrowser = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-fetch-test-'))
  const scriptPath = path.join(dir, 'mock-agent-browser.mjs')
  const script = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)

if (process.env.MOCK_AGENT_BROWSER_FAIL_OPEN === '1' && args.includes('open')) {
  console.error('simulated open failure')
  process.exit(1)
}

if (process.env.MOCK_AGENT_BROWSER_WARN_PROFILE_IGNORED === '1' && args.includes('--profile')) {
  console.error("⚠ --profile ignored: daemon already running. Use 'agent-browser close' first to restart with new options.")
}

if (process.env.MOCK_AGENT_BROWSER_REQUIRE_HEADED === '1' && args.includes('open') && !args.includes('--headed')) {
  console.error('expected --headed flag on open')
  process.exit(1)
}

if (process.env.MOCK_AGENT_BROWSER_REQUIRE_HEADED === '1' && !args.includes('open') && args.includes('--headed')) {
  console.error('unexpected --headed flag outside open')
  process.exit(1)
}

if (args.includes('get') && args.includes('html')) {
  process.stdout.write(${JSON.stringify(AGENT_BROWSER_HTML)})
  process.exit(0)
}

if (args.includes('screenshot')) {
  const outputPath = args[args.length - 1]
  writeFileSync(outputPath, 'fake-png-data')
  process.stdout.write(JSON.stringify({ success: true, data: { path: outputPath }, error: null }))
  process.exit(0)
}

process.exit(0)
`

  writeFileSync(scriptPath, script, 'utf-8')
  chmodSync(scriptPath, 0o755)
  return scriptPath
}

const largeWordBlob = (count: number): string =>
  Array.from({ length: count }, () => 'word').join(' ')

describe('agent-fetch engine', () => {
  beforeAll(() => {
    mockAgentBrowserPath = createMockAgentBrowser()

    server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(req.url === '/portal' ? PORTAL_HTML : BASE_HTML)
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
    expect(result.outputMode).toBe('markdown')
    expect(result.content).toContain('# Example Domain')
    expect(result.attempts).toHaveLength(1)
    const [fetchAttempt] = result.attempts
    expect(fetchAttempt?.strategy).toBe('fetch')
    expect(fetchAttempt?.ok).toBe(true)
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
    const [fetchAttempt, jsdomAttempt, pluginAttempt] = result.attempts
    expect(fetchAttempt?.strategy).toBe('fetch')
    expect(fetchAttempt?.ok).toBe(false)
    expect(jsdomAttempt?.strategy).toBe('jsdom')
    expect(jsdomAttempt?.ok).toBe(false)
    expect(pluginAttempt?.strategy).toBe('mock-threshold')
    expect(pluginAttempt?.ok).toBe(true)
  })

  it('jumps directly to agent-browser in authenticated mode', async () => {
    const result = await fetchUrl(baseUrl, {
      withCredentials: true,
      enableFetch: true,
      enableJsdom: true,
      enablePlugins: true,
      plugins: [{ type: 'scrape-do', token: 'unused' }],
      agentBrowser: {
        profile: '/tmp/test-profile',
        command: mockAgentBrowserPath,
      },
      minHtmlLength: 20,
      minWordCount: 3,
      minMarkdownLength: 20,
    })

    expect(result.strategy).toBe('agent-browser')
    expect(result.content).toContain('# Authenticated Page')
    expect(result.attempts).toHaveLength(1)
    const [browserAttempt] = result.attempts
    expect(browserAttempt?.strategy).toBe('agent-browser')
    expect(browserAttempt?.ok).toBe(true)
  })

  it('fails fast when authenticated mode agent-browser fails', async () => {
    process.env.MOCK_AGENT_BROWSER_FAIL_OPEN = '1'

    try {
      await fetchUrl(baseUrl, {
        withCredentials: true,
        agentBrowser: {
          profile: '/tmp/test-profile',
          command: mockAgentBrowserPath,
        },
      })
      throw new Error('Expected fetchUrl to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(FetchError)
      const fetchError = error as FetchError
      expect(fetchError.message).toContain('Authenticated fetch failed')
      expect(fetchError.attempts).toHaveLength(1)
      const [browserAttempt] = fetchError.attempts
      expect(browserAttempt?.strategy).toBe('agent-browser')
      expect(browserAttempt?.ok).toBe(false)
    } finally {
      delete process.env.MOCK_AGENT_BROWSER_FAIL_OPEN
    }
  })

  it('fails with an actionable error when agent-browser ignores the requested profile', async () => {
    process.env.MOCK_AGENT_BROWSER_WARN_PROFILE_IGNORED = '1'

    try {
      await fetchUrl(baseUrl, {
        withCredentials: true,
        agentBrowser: {
          profile: '/tmp/test-profile',
          command: mockAgentBrowserPath,
        },
      })
      throw new Error('Expected fetchUrl to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(FetchError)
      const fetchError = error as FetchError
      expect(fetchError.message).toContain('Authenticated fetch failed')
      expect(fetchError.attempts).toHaveLength(1)
      expect(fetchError.attempts[0]?.strategy).toBe('agent-browser')
      expect(fetchError.attempts[0]?.ok).toBe(false)
      expect(fetchError.attempts[0]?.error).toContain(
        'agent-browser ignored the requested profile',
      )
    } finally {
      delete process.env.MOCK_AGENT_BROWSER_WARN_PROFILE_IGNORED
    }
  })

  it('passes headed through to agent-browser when requested', async () => {
    process.env.MOCK_AGENT_BROWSER_REQUIRE_HEADED = '1'

    try {
      const result = await fetchUrl(baseUrl, {
        method: 'agent-browser',
        agentBrowser: {
          command: mockAgentBrowserPath,
          headed: true,
        },
        minHtmlLength: 20,
        minWordCount: 3,
        minMarkdownLength: 20,
      })

      expect(result.strategy).toBe('agent-browser')
      expect(result.content).toContain('# Authenticated Page')
      expect(result.attempts).toHaveLength(1)
      expect(result.attempts[0]?.ok).toBe(true)
    } finally {
      delete process.env.MOCK_AGENT_BROWSER_REQUIRE_HEADED
    }
  })

  it('returns structured output for portal pages', async () => {
    const result = await fetchUrl(`${baseUrl}/portal`, {
      strategyMode: 'simple',
      outputMode: 'structured',
      enableAgentBrowser: false,
      enableJsdom: false,
      enablePlugins: false,
      minHtmlLength: 20,
      minWordCount: 5,
      minMarkdownLength: 20,
    })

    expect(result.outputMode).toBe('structured')
    expect(result.markdown).toContain('## [News]')
    expect(result.markdown).toContain('## [Markets]')
    expect(result.markdown).not.toContain('Risk Disclosure')
    expect(
      result.structuredContent?.sections.some((section) => section.heading === 'News'),
    ).toBe(true)
  })

  it('returns screenshot output via agent-browser when requested', async () => {
    const result = await fetchUrl(baseUrl, {
      outputMode: 'screenshot',
      enableFetch: true,
      enableJsdom: true,
      enablePlugins: true,
      agentBrowser: {
        command: mockAgentBrowserPath,
      },
    })

    expect(result.outputMode).toBe('screenshot')
    expect(result.strategy).toBe('agent-browser')
    expect(result.screenshotPath).toBeTruthy()
    expect(result.content).toBe(result.screenshotPath ?? '')
    expect(result.markdown).toContain('# Authenticated Page')
    expect(existsSync(result.screenshotPath as string)).toBe(true)
    expect(result.attempts).toHaveLength(1)
    expect(result.attempts[0]?.strategy).toBe('agent-browser')
    expect(result.attempts[0]?.ok).toBe(true)
  })

  it('runs only the requested method when method override is set', async () => {
    try {
      await fetchUrl(baseUrl, {
        method: 'fetch',
        enableAgentBrowser: true,
        enableJsdom: true,
        enablePlugins: true,
        plugins: [{ type: 'scrape-do', token: 'unused' }],
        minWordCount: 1000,
      })
      throw new Error('Expected fetchUrl to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(FetchError)
      const fetchError = error as FetchError
      expect(fetchError.attempts).toHaveLength(1)
      expect(fetchError.attempts[0]?.strategy).toBe('fetch')
    }
  })
})
