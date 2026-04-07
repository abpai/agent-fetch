import { loadRuntimeConfig } from '../../config/loader'
import { fetchUrl } from '../../core/fetch-engine'
import { serializeFetchResult } from '../../core/serialize'
import { FetchError } from '../../core/types'
import type { FetchOptions, OutputMode } from '../../core/types'
import type { ServerCommand } from '../types'

interface ServerDependencies {
  error: (message: string) => void
}

const MAX_BODY_BYTES = 1_048_576
const HTTP_TIMEOUT_MS = 120_000

const httpError = (message: string, status: number): Error =>
  Object.assign(new Error(message), { status })

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

const UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent-fetch</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Doto:wght@400&family=Space+Grotesk:wght@300;400;500&family=Space+Mono:wght@400&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --black: #000000;
    --surface: #111111;
    --surface-raised: #1A1A1A;
    --border: #222222;
    --border-visible: #333333;
    --text-disabled: #666666;
    --text-secondary: #999999;
    --text-primary: #E8E8E8;
    --text-display: #FFFFFF;
    --accent: #D71921;
    --success: #4A9E5C;
  }

  body {
    background: var(--black);
    color: var(--text-primary);
    font-family: 'Space Grotesk', system-ui, sans-serif;
    font-weight: 400;
    font-size: 16px;
    line-height: 1.5;
    min-height: 100vh;
    padding: 96px 24px 48px;
    max-width: 720px;
    margin: 0 auto;
  }

  h1 {
    font-family: 'Doto', 'Space Mono', monospace;
    font-size: 48px;
    font-weight: 400;
    letter-spacing: -0.02em;
    line-height: 1.05;
    color: var(--text-display);
    margin-bottom: 64px;
  }

  .label {
    font-family: 'Space Mono', monospace;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }

  .input-row {
    display: flex;
    gap: 12px;
    margin-bottom: 8px;
  }

  input[type="text"] {
    flex: 1;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border-visible);
    color: var(--text-display);
    font-family: 'Space Mono', monospace;
    font-size: 16px;
    padding: 12px 0;
    outline: none;
    transition: border-color 200ms cubic-bezier(0.25, 0.1, 0.25, 1);
  }

  input[type="text"]::placeholder {
    color: var(--text-disabled);
  }

  input[type="text"]:focus {
    border-bottom-color: var(--text-primary);
  }

  button {
    font-family: 'Space Mono', monospace;
    font-size: 13px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    background: var(--text-display);
    color: var(--black);
    border: none;
    border-radius: 999px;
    padding: 12px 24px;
    cursor: pointer;
    min-height: 44px;
    white-space: nowrap;
    transition: opacity 200ms cubic-bezier(0.25, 0.1, 0.25, 1);
  }

  button:hover { opacity: 0.85; }
  button:disabled { opacity: 0.4; cursor: default; }

  .status {
    font-family: 'Space Mono', monospace;
    font-size: 12px;
    letter-spacing: 0.04em;
    color: var(--text-disabled);
    min-height: 20px;
    margin-bottom: 48px;
  }

  .status.error { color: var(--accent); }
  .status.ok { color: var(--success); }

  .result-label {
    display: none;
  }

  .result-label.visible {
    display: block;
  }

  .result {
    display: none;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 24px;
    font-family: 'Space Mono', monospace;
    font-size: 14px;
    line-height: 1.5;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 70vh;
    overflow-y: auto;
  }

  .result.visible {
    display: block;
  }

  .result::-webkit-scrollbar { width: 4px; }
  .result::-webkit-scrollbar-track { background: transparent; }
  .result::-webkit-scrollbar-thumb { background: var(--border-visible); border-radius: 2px; }
</style>
</head>
<body>
  <h1>agent-fetch</h1>

  <div class="label">URL</div>
  <div class="input-row">
    <input type="text" id="url" placeholder="https://example.com" autofocus>
    <button id="go" onclick="doFetch()">FETCH</button>
  </div>
  <div class="status" id="status"></div>

  <div class="label result-label" id="result-label">OUTPUT</div>
  <pre class="result" id="result"></pre>

  <script>
    const urlInput = document.getElementById('url');
    const btn = document.getElementById('go');
    const status = document.getElementById('status');
    const result = document.getElementById('result');
    const resultLabel = document.getElementById('result-label');

    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !btn.disabled) doFetch();
    });

    async function doFetch() {
      const url = urlInput.value.trim();
      if (!url) return;

      btn.disabled = true;
      status.className = 'status';
      status.textContent = '[FETCHING...]';
      result.classList.remove('visible');
      resultLabel.classList.remove('visible');

      const start = Date.now();
      try {
        const res = await fetch('/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const elapsed = Date.now() - start;
        const text = await res.text();

        if (!res.ok) {
          status.className = 'status error';
          status.textContent = '[ERROR] ' + text;
          return;
        }

        status.className = 'status ok';
        status.textContent = '[OK] ' + res.status + ' — ' + elapsed + 'ms';
        result.textContent = text;
        result.classList.add('visible');
        resultLabel.classList.add('visible');
      } catch (err) {
        status.className = 'status error';
        status.textContent = '[ERROR] ' + err.message;
      } finally {
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>`

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

const parseRequestBody = async (
  request: Request,
): Promise<{ url: string; options?: Partial<FetchOptions> }> => {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    throw httpError('Request body too large', 413)
  }

  let raw: string
  try {
    raw = await request.text()
  } catch {
    throw httpError('Failed to read request body', 400)
  }

  if (Buffer.byteLength(raw, 'utf-8') > MAX_BODY_BYTES) {
    throw httpError('Request body too large', 413)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw httpError('Invalid JSON in request body', 400)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw httpError('Request body must be a JSON object', 400)
  }

  const body = parsed as Record<string, unknown>

  if (typeof body.url !== 'string' || !body.url.trim()) {
    throw httpError('Missing or empty "url" field', 400)
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
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(httpError('Request timeout', 504)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

export const handleRequest = async (
  request: Request,
  configDefaults: Partial<FetchOptions>,
  environment: Record<string, string>,
  pathname?: string,
): Promise<Response> => {
  const method = request.method
  pathname ??= new URL(request.url).pathname

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (pathname === '/' && method === 'GET') {
    return new Response(UI_HTML, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/html' },
    })
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
  const json = wantsJson(request)
  try {
    const body = await parseRequestBody(request)
    const options = mergeOptions(configDefaults, environment, body.options)
    const result = await withTimeout(fetchUrl(body.url, options), HTTP_TIMEOUT_MS)

    if (json) {
      return jsonResponse({ ok: true, result: serializeFetchResult(result) }, 200)
    }

    return textResponse(result.content, 200, contentTypeForMode(result.outputMode))
  } catch (error) {
    return errorResponse(error, json)
  }
}

const errorResponse = (error: unknown, json: boolean): Response => {
  if (error instanceof FetchError) {
    return json
      ? jsonResponse({ ok: false, error: error.message, attempts: error.attempts }, 422)
      : textResponse(error.message, 422)
  }

  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status
    const message = error instanceof Error ? error.message : 'Unknown error'

    return json
      ? jsonResponse({ ok: false, error: message }, status)
      : textResponse(message, status)
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

      const response = await handleRequest(request, configDefaults, environment, pathname)

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
