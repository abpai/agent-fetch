# agent-fetch

`agent-fetch` is a robust fetch CLI for AI agents.

By default it returns a useful markdown view of the rendered page, closer to a broad page snapshot than an article-only extractor. You can switch to article-style output, raw HTML, or structured section data when you need something narrower or more mechanical.

It tries the cheapest strategy first, then escalates when needed:

1. `fetch`
2. `jsdom`
3. configured plugins
4. `agent-browser`

Authenticated mode is explicit: `--with-credentials` jumps straight to `agent-browser` and fails fast if credentials are missing or invalid.

Every successful result also passes lightweight acceptance checks so the CLI can reject obviously blocked, paywalled, or too-thin responses before escalating to the next strategy.

## Install

```bash
bun add @andypai/agent-fetch
```

`agent-fetch` is Bun-only. Use Bun for install, runtime, tests, and local tooling. Node.js and other package managers are not supported.

## CLI

### Fetch

```bash
# Markdown output (default)
agent-fetch fetch https://example.com

# Shorthand: a bare URL implies `fetch`
agent-fetch https://example.com

# Output mode overrides
agent-fetch fetch https://example.com --mode markdown
agent-fetch fetch https://example.com --mode primary
agent-fetch fetch https://example.com --mode html
agent-fetch fetch https://example.com --mode structured

# JSON output
agent-fetch fetch https://example.com --json

# Print per-attempt diagnostics to stderr
agent-fetch fetch https://example.com --debug-attempts

# Use an explicit config file
agent-fetch fetch https://example.com --config /tmp/agent-fetch.json

# Disable fallback stages
agent-fetch fetch https://example.com --no-jsdom --no-plugins

# Authenticated fast path (agent-browser only)
agent-fetch fetch https://example.com --with-credentials

# Force strategy mode
agent-fetch fetch https://example.com --strategy simple
agent-fetch fetch https://example.com --strategy authenticated
```

### Output modes

- `markdown` (default): convert the cleaned rendered page into markdown and keep broad page structure such as headings, cards, and tables when possible.
- `primary`: extract article-style primary content with Readability, with metadata fallback for pages that do not have a clear article body.
- `html`: return the rendered HTML that `agent-fetch` fetched.
- `structured`: return structured section data derived from markdown headings and links.

### Setup

```bash
# Guided setup
agent-fetch setup

# Alias
agent-fetch init

# Non-interactive setup from env vars
AGENT_FETCH_TIMEOUT=45000 \
AGENT_FETCH_ENABLE_PLUGINS=true \
SCRAPEDO_TOKEN=your-token \
AGENT_FETCH_ENABLE_AGENT_BROWSER=true \
AGENT_FETCH_CDP_PORT=9222 \
agent-fetch setup --no-input --overwrite
```

The setup walkthrough can now configure:

- default strategy mode
- timeout and content validation thresholds
- fetch/jsdom/plugin/agent-browser fallbacks
- optional scrape.do plugin wiring
- authenticated browser CDP defaults
- whether `agent-browser` waits for `networkidle` before extraction

### Plugins

```bash
agent-fetch plugins list
agent-fetch plugins list --json
```

## Configuration

Default config path:

- `~/.config/agent-fetch/config.json`

Default shared env path:

- `~/.config/agent-fetch/.env`

The config file stores runtime defaults. The shared env file stores machine-specific values and secrets such as `AGENT_FETCH_CDP_PORT`, `AGENT_FETCH_CDP_LAUNCH`, and `SCRAPEDO_TOKEN`.

At runtime, precedence is:

1. CLI flags
2. environment variables (including the shared `.env` file)
3. config file
4. built-in defaults

Example config:

```json
{
  "timeout": 30000,
  "outputMode": "markdown",
  "enableFetch": true,
  "enableJsdom": true,
  "enablePlugins": true,
  "enableAgentBrowser": true,
  "strategyMode": "auto",
  "plugins": [
    {
      "type": "scrape-do",
      "token": "${SCRAPEDO_TOKEN}"
    }
  ],
  "waitForNetworkIdle": false
}
```

Notes:

- `waitForNetworkIdle` affects `agent-browser` navigation timing.
- Plugin config values support `${ENV_VAR}` interpolation.
- `plugins` are only used in `auto` mode, after `fetch` and `jsdom`.

Example shared env file:

```bash
AGENT_FETCH_CDP_PORT=9222
AGENT_FETCH_CDP_LAUNCH='open -na "Google Chrome" --args --remote-debugging-port=9222'
SCRAPEDO_TOKEN=your-token
```

### Legacy config behavior

Legacy config files are now rejected with a hard error:

- `.fetchrc.json`
- `fetch.config.json`

Move settings to `~/.config/agent-fetch/config.json`.

### Supported setup env vars

- `AGENT_FETCH_TIMEOUT`
- `AGENT_FETCH_OUTPUT_MODE`
- `AGENT_FETCH_ENABLE_FETCH`
- `AGENT_FETCH_ENABLE_JSDOM`
- `AGENT_FETCH_ENABLE_PLUGINS`
- `AGENT_FETCH_ENABLE_AGENT_BROWSER`
- `AGENT_FETCH_STRATEGY_MODE`
- `AGENT_FETCH_WAIT_FOR_NETWORK_IDLE`
- `AGENT_FETCH_USER_AGENT`
- `AGENT_FETCH_MIN_HTML_LENGTH`
- `AGENT_FETCH_MIN_MARKDOWN_LENGTH`
- `AGENT_FETCH_MIN_WORD_COUNT`
- `AGENT_FETCH_BLOCKED_WORD_COUNT_THRESHOLD`
- `AGENT_FETCH_CDP_PORT`
- `AGENT_FETCH_CDP_LAUNCH`
- `AGENT_FETCH_AGENT_BROWSER_COMMAND`
- `SCRAPEDO_TOKEN`

## Library usage

```ts
import { fetchUrl } from '@andypai/agent-fetch'

const result = await fetchUrl('https://example.com', {
  strategyMode: 'auto',
  outputMode: 'markdown',
})

console.log(result.outputMode)
console.log(result.strategy)
console.log(result.content)
```

The package also exports `FetchError`, `registerPlugin()`, and `listBuiltinPlugins()` if you want to embed the engine or add custom plugins programmatically.

## Output contract (`--json`)

```json
{
  "url": "string",
  "title": "string",
  "author": "string | null",
  "content": "string",
  "outputMode": "markdown | primary | html | structured",
  "markdown": "string",
  "primaryMarkdown": "string",
  "html": "string",
  "structuredContent": {
    "title": "string",
    "description": "string | null",
    "headings": [{ "level": 2, "text": "Example" }],
    "sections": [{ "heading": "Example", "level": 2, "content": "..." }],
    "links": [{ "text": "Example", "href": "https://example.com" }]
  },
  "wordCount": 123,
  "strategy": "fetch | jsdom | plugin-name | agent-browser",
  "fetchedAt": "ISO-8601",
  "attempts": [
    {
      "strategy": "fetch",
      "ok": true,
      "durationMs": 120
    }
  ]
}
```

`content` always matches the selected output mode. `markdown` remains available in JSON output even when `--mode` is `primary`, `html`, or `structured`, so callers can inspect both the selected output and the full-page markdown snapshot.

When `--mode structured` is used without `--json`, `content` is the pretty-printed JSON string for `structuredContent`.

## Development

```bash
bun install
bun run build
bun run check
bun run test
```

### Scripts

```bash
bun run dev        # run with watch mode
bun run start      # run once
bun run build      # bun build ./src/index.ts --target bun --outdir ./dist
bun run format     # prettier write
bun run lint       # eslint
bun run typecheck  # tsc --noEmit
bun run test       # bun test src
bun run test:watch # bun test --watch src
bun run check      # prettier check + lint + typecheck + test
```
