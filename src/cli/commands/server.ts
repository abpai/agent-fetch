import { loadRuntimeConfig } from '../../config/loader'
import { fetchUrl } from '../../core/fetch-engine'
import { FetchError } from '../../core/types'
import type { FetchOptions, OutputMode } from '../../core/types'
import type { ServerCommand } from '../types'

interface ServerDependencies {
  error: (message: string) => void
}

const MAX_BODY_BYTES = 1_048_576
const HTTP_TIMEOUT_MS = 120_000

const wantsJson = (request: Request): boolean =>
  request.headers.get('accept')?.includes('application/json') === true

const contentTypeForMode = (mode: OutputMode): string => {
  switch (mode) {
    case 'html':
      return 'text/html'
    case 'structured':
      return 'application/json'
    case 'screenshot':
      return 'text/plain'
    default:
      return 'text/markdown'
  }
}

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
}

const jsonResponse = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const textResponse = (
  body: string,
  status: number,
  contentType = 'text/plain',
): Response =>
  new Response(body, {
    status,
    headers: { ...corsHeaders, 'Content-Type': contentType },
  })

const serializeResult = (result: Awaited<ReturnType<typeof fetchUrl>>) => ({
  url: result.url,
  title: result.title,
  author: result.author,
  content: result.content,
  outputMode: result.outputMode,
  screenshotPath: result.screenshotPath,
  markdown: result.markdown,
  primaryMarkdown: result.primaryMarkdown,
  html: result.html,
  structuredContent: result.structuredContent,
  wordCount: result.wordCount,
  strategy: result.strategy,
  fetchedAt: result.fetchedAt.toISOString(),
  attempts: result.attempts,
})

const parseRequestBody = async (
  request: Request,
): Promise<{ url: string; options?: Partial<FetchOptions> }> => {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    throw Object.assign(new Error('Request body too large'), { status: 413 })
  }

  let raw: string
  try {
    raw = await request.text()
  } catch {
    throw Object.assign(new Error('Failed to read request body'), { status: 400 })
  }

  if (Buffer.byteLength(raw, 'utf-8') > MAX_BODY_BYTES) {
    throw Object.assign(new Error('Request body too large'), { status: 413 })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw Object.assign(new Error('Invalid JSON in request body'), { status: 400 })
  }

  if (!parsed || typeof parsed !== 'object') {
    throw Object.assign(new Error('Request body must be a JSON object'), { status: 400 })
  }

  const body = parsed as Record<string, unknown>

  if (typeof body.url !== 'string' || !body.url.trim()) {
    throw Object.assign(new Error('Missing or empty "url" field'), { status: 400 })
  }

  return {
    url: body.url,
    options: body.options as Partial<FetchOptions> | undefined,
  }
}

const mergeOptions = (
  configDefaults: Partial<FetchOptions>,
  environment: Record<string, string>,
  requestOptions?: Partial<FetchOptions>,
): FetchOptions => {
  const merged: FetchOptions = {
    ...configDefaults,
    ...requestOptions,
    environment,
  }

  if (requestOptions?.agentBrowser || configDefaults.agentBrowser) {
    merged.agentBrowser = {
      ...configDefaults.agentBrowser,
      ...requestOptions?.agentBrowser,
    }
  }

  return merged
}

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error('Request timeout'), { status: 504 }))
    }, ms)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export const handleRequest = async (
  request: Request,
  configDefaults: Partial<FetchOptions>,
  environment: Record<string, string>,
): Promise<Response> => {
  const { method, url } = request
  const pathname = new URL(url).pathname

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (pathname === '/health' && method === 'GET') {
    return jsonResponse({ ok: true }, 200)
  }

  if (pathname === '/fetch' && method === 'POST') {
    return handleFetch(request, configDefaults, environment)
  }

  return wantsJson(request)
    ? jsonResponse({ ok: false, error: 'Not found' }, 404)
    : textResponse('Not found', 404)
}

const handleFetch = async (
  request: Request,
  configDefaults: Partial<FetchOptions>,
  environment: Record<string, string>,
): Promise<Response> => {
  try {
    const body = await parseRequestBody(request)
    const options = mergeOptions(configDefaults, environment, body.options)
    const result = await withTimeout(fetchUrl(body.url, options), HTTP_TIMEOUT_MS)

    if (wantsJson(request)) {
      return jsonResponse({ ok: true, result: serializeResult(result) }, 200)
    }

    return textResponse(result.content, 200, contentTypeForMode(result.outputMode))
  } catch (error) {
    return errorResponse(error, wantsJson(request))
  }
}

const errorResponse = (error: unknown, json: boolean): Response => {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status
    const message = error instanceof Error ? error.message : 'Unknown error'

    return json
      ? jsonResponse({ ok: false, error: message }, status)
      : textResponse(message, status)
  }

  if (error instanceof FetchError) {
    return json
      ? jsonResponse({ ok: false, error: error.message, attempts: error.attempts }, 422)
      : textResponse(error.message, 422)
  }

  const message = error instanceof Error ? error.message : 'Internal server error'
  return json
    ? jsonResponse({ ok: false, error: message }, 500)
    : textResponse(message, 500)
}

export const runServerCommand = async (
  command: ServerCommand,
  dependencies: ServerDependencies,
): Promise<number> => {
  const runtime = await loadRuntimeConfig({ configPath: command.configPath })
  const configDefaults: Partial<FetchOptions> = {
    ...runtime.config,
    plugins: runtime.config.plugins ?? [],
  }
  const environment = runtime.environment

  const server = Bun.serve({
    port: command.port,
    hostname: command.host,
    fetch: async (request) => {
      const start = Date.now()
      const { method } = request
      const pathname = new URL(request.url).pathname

      const response = await handleRequest(request, configDefaults, environment)

      const duration = Date.now() - start
      dependencies.error(`${method} ${pathname} ${response.status} ${duration}ms`)

      return response
    },
  })

  dependencies.error(`Listening on http://${server.hostname}:${server.port}`)

  const shutdown = () => {
    server.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  return new Promise<number>(() => {})
}
