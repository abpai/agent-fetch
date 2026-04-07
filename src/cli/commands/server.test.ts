import { describe, expect, it } from 'bun:test'
import { handleRequest } from './server'

const makeRequest = (
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Request => {
  const init: RequestInit = { method, headers: headers ?? {} }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
  }
  return new Request(`http://localhost:7411${path}`, init)
}

const emptyConfig = {}
const emptyEnv: Record<string, string> = {}

describe('GET /health', () => {
  it('returns ok', async () => {
    const res = await handleRequest(makeRequest('GET', '/health'), emptyConfig, emptyEnv)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('Content-Type')).toBe('application/json')
  })
})

describe('GET /', () => {
  it('returns the built-in fetch UI', async () => {
    const res = await handleRequest(makeRequest('GET', '/'), emptyConfig, emptyEnv)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html')
    const html = await res.text()
    expect(html).toContain('<title>agent-fetch</title>')
    expect(html).toContain('id="url"')
    expect(html).toContain("fetch('/fetch'")
  })
})

describe('POST /fetch', () => {
  it('returns markdown by default', async () => {
    const res = await handleRequest(
      makeRequest('POST', '/fetch', { url: 'https://example.com' }),
      emptyConfig,
      emptyEnv,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/markdown')
    const text = await res.text()
    expect(text).toContain('Example Domain')
  })

  it('returns JSON when Accept: application/json', async () => {
    const res = await handleRequest(
      makeRequest(
        'POST',
        '/fetch',
        { url: 'https://example.com' },
        {
          Accept: 'application/json',
        },
      ),
      emptyConfig,
      emptyEnv,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/json')
    const json = (await res.json()) as {
      ok: boolean
      result: { url: string; fetchedAt: string }
    }
    expect(json.ok).toBe(true)
    expect(json.result.url).toBe('https://example.com')
    expect(typeof json.result.fetchedAt).toBe('string')
  })

  it('returns text/html Content-Type for html outputMode', async () => {
    const res = await handleRequest(
      makeRequest('POST', '/fetch', {
        url: 'https://example.com',
        options: { outputMode: 'html', strategy: 'simple' },
      }),
      emptyConfig,
      emptyEnv,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html')
    const text = await res.text()
    expect(text).toContain('<html')
  })

  it('passes options through to fetchUrl', async () => {
    const res = await handleRequest(
      makeRequest(
        'POST',
        '/fetch',
        {
          url: 'https://example.com',
          options: { outputMode: 'primary', strategy: 'simple' },
        },
        { Accept: 'application/json' },
      ),
      emptyConfig,
      emptyEnv,
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; result: { outputMode: string } }
    expect(json.ok).toBe(true)
    expect(json.result.outputMode).toBe('primary')
  })
})

describe('error responses', () => {
  it('returns 400 for missing url', async () => {
    const res = await handleRequest(
      makeRequest('POST', '/fetch', { nope: true }),
      emptyConfig,
      emptyEnv,
    )
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toContain('url')
  })

  it('returns 400 for empty url', async () => {
    const res = await handleRequest(
      makeRequest('POST', '/fetch', { url: '' }),
      emptyConfig,
      emptyEnv,
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 for malformed JSON', async () => {
    const req = new Request('http://localhost:7411/fetch', {
      method: 'POST',
      body: 'not json{{{',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await handleRequest(req, emptyConfig, emptyEnv)
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toContain('Invalid JSON')
  })

  it('returns 400 JSON error when Accept: application/json', async () => {
    const res = await handleRequest(
      makeRequest('POST', '/fetch', { nope: true }, { Accept: 'application/json' }),
      emptyConfig,
      emptyEnv,
    )
    expect(res.status).toBe(400)
    const json = (await res.json()) as { ok: boolean; error: string }
    expect(json.ok).toBe(false)
    expect(json.error).toContain('url')
  })

  it('returns 422 for fetch failures (simple mode, bad url)', async () => {
    const res = await handleRequest(
      makeRequest(
        'POST',
        '/fetch',
        {
          url: 'https://this-domain-does-not-exist-zzzz.invalid',
          options: { strategy: 'simple', timeout: 3000 },
        },
        { Accept: 'application/json' },
      ),
      emptyConfig,
      emptyEnv,
    )
    expect(res.status).toBe(422)
    const json = (await res.json()) as { ok: boolean; error: string; attempts: unknown[] }
    expect(json.ok).toBe(false)
    expect(json.attempts).toBeDefined()
  })

  it('returns 413 for oversized request body', async () => {
    const bigPayload = JSON.stringify({
      url: 'https://example.com',
      padding: 'x'.repeat(1_100_000),
    })
    const req = new Request('http://localhost:7411/fetch', {
      method: 'POST',
      body: bigPayload,
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await handleRequest(req, emptyConfig, emptyEnv)
    expect(res.status).toBe(413)
  })
})

describe('routing', () => {
  it('returns 404 for unknown paths', async () => {
    const res = await handleRequest(makeRequest('GET', '/nope'), emptyConfig, emptyEnv)
    expect(res.status).toBe(404)
  })

  it('returns 404 JSON for unknown paths with Accept: application/json', async () => {
    const res = await handleRequest(
      makeRequest('GET', '/nope', undefined, { Accept: 'application/json' }),
      emptyConfig,
      emptyEnv,
    )
    expect(res.status).toBe(404)
    const json = (await res.json()) as { ok: boolean }
    expect(json.ok).toBe(false)
  })

  it('returns 204 for OPTIONS (CORS preflight)', async () => {
    const res = await handleRequest(
      makeRequest('OPTIONS', '/fetch'),
      emptyConfig,
      emptyEnv,
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})

describe('CORS headers', () => {
  it('includes CORS headers on all responses', async () => {
    const res = await handleRequest(makeRequest('GET', '/health'), emptyConfig, emptyEnv)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})

describe('config merging', () => {
  it('applies config defaults when no request options given', async () => {
    const res = await handleRequest(
      makeRequest(
        'POST',
        '/fetch',
        { url: 'https://example.com' },
        {
          Accept: 'application/json',
        },
      ),
      { outputMode: 'primary' },
      emptyEnv,
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { result: { outputMode: string } }
    expect(json.result.outputMode).toBe('primary')
  })

  it('request options override config defaults', async () => {
    const res = await handleRequest(
      makeRequest(
        'POST',
        '/fetch',
        {
          url: 'https://example.com',
          options: { outputMode: 'html' },
        },
        { Accept: 'application/json' },
      ),
      { outputMode: 'primary' },
      emptyEnv,
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { result: { outputMode: string } }
    expect(json.result.outputMode).toBe('html')
  })
})

describe('CLI parsing', () => {
  it('parses server command with defaults', async () => {
    const { parseCliArgs } = await import('../../cli/index')
    const parsed = parseCliArgs(['server'])
    expect(parsed).toEqual({
      command: 'server',
      port: 7411,
      host: '127.0.0.1',
      configPath: undefined,
    })
  })

  it('parses server command with flags', async () => {
    const { parseCliArgs } = await import('../../cli/index')
    const parsed = parseCliArgs([
      'server',
      '--port',
      '8080',
      '--host',
      '0.0.0.0',
      '--config',
      '/tmp/config.json',
    ])
    expect(parsed).toEqual({
      command: 'server',
      port: 8080,
      host: '0.0.0.0',
      configPath: '/tmp/config.json',
    })
  })
})
