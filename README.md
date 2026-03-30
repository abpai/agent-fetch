# agent-fetch

A fetch CLI for AI agents.

Fetching web pages programmatically has gotten messy. Cloudflare bot detection, server-side rendering, SPAs that return empty `<div>`s, paywalls — half the web blocks a plain `fetch` even when you aren't doing anything adversarial. You can throw a headless browser at every request, or route through a third-party scraping API, but that's wasteful when `curl` would've worked for most of your list.

`agent-fetch` tries the cheapest method first and escalates only when needed:

1. `fetch`
2. `jsdom`
3. configured plugins (e.g. scrape.do)
4. `agent-browser` (headless Chrome)

Each response passes lightweight acceptance checks — word count, blocked-page detection — so bad results get caught and the next strategy gets tried automatically.

Output varies by use case: full-page markdown (default), article extraction, raw HTML, structured section data, or a full-page screenshot. Pick with `--mode`.

When a page requires login, `agent-fetch` uses a sandboxed browser profile you set up ahead of time — not your full browser session, just the credentials needed for fetching. If the profile is missing, it fails fast rather than silently falling back to unauthenticated requests.

## Install

```bash
bun add @andypai/agent-fetch
```

`agent-fetch` is Bun-only. Use Bun for install, runtime, tests, and local tooling. Node.js and other package managers are not supported.

## Docs

- [Architecture](./docs/ARCHITECTURE.md)
- [Testing Guide](./docs/TESTING.md)

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
agent-fetch fetch https://example.com --mode screenshot

# JSON output
agent-fetch fetch https://example.com --json

# Print per-attempt diagnostics to stderr
agent-fetch fetch https://example.com --debug-attempts

# Use an explicit config file
agent-fetch fetch https://example.com --config /tmp/agent-fetch.json

# Use a persistent browser profile for a one-off authenticated request
agent-fetch fetch https://example.com --with-credentials --profile ~/.agent-browser/profiles/work

# Disable fallback stages
agent-fetch fetch https://example.com --no-jsdom --no-plugins

# Authenticated fast path (agent-browser only)
agent-fetch fetch https://example.com --with-credentials

# Force strategy mode
agent-fetch fetch https://example.com --strategy simple
agent-fetch fetch https://example.com --strategy authenticated

# Force one exact method
agent-fetch fetch https://example.com --method fetch
agent-fetch fetch https://example.com --method jsdom
agent-fetch fetch https://example.com --method agent-browser
agent-fetch fetch https://example.com --method scrape.do
```

### Output modes

- `markdown` (default): convert the cleaned rendered page into markdown and keep broad page structure such as headings, cards, and tables when possible.
- `primary`: extract article-style primary content with Readability, with metadata fallback for pages that do not have a clear article body.
- `html`: return the rendered HTML that `agent-fetch` fetched.
- `structured`: return structured section data derived from markdown headings and links.
- `screenshot`: take a full-page screenshot through `agent-browser` and return the saved image path.

### Method override

Use `--method` when you want one exact stage instead of the usual fallback chain.

- `fetch`
- `jsdom`
- `agent-browser`
- built-in plugin types such as `scrape.do`

Notes:

- `--method scrape.do` normalizes to the built-in `scrape-do` plugin type.
- `--mode screenshot` always uses `agent-browser`; combining it with another method is rejected.

### Setup

```bash
# Guided setup
agent-fetch setup

# Alias
agent-fetch init

# Write setup artifacts somewhere other than the defaults
agent-fetch setup --config /tmp/agent-fetch.json --env-file /tmp/agent-fetch.env

# Non-interactive setup from env vars
AGENT_FETCH_TIMEOUT=45000 \
AGENT_FETCH_ENABLE_PLUGINS=true \
SCRAPEDO_TOKEN=your-token \
AGENT_FETCH_ENABLE_AGENT_BROWSER=true \
AGENT_FETCH_PROFILE=~/.agent-browser/profiles/work \
agent-fetch setup --no-input --overwrite

# Authenticated defaults in non-interactive mode require a profile
AGENT_FETCH_STRATEGY_MODE=authenticated \
AGENT_FETCH_PROFILE=~/.agent-browser/profiles/work \
agent-fetch setup --no-input --overwrite
```

`agent-fetch setup --no-input` only requires `AGENT_FETCH_PROFILE` when you are
writing authenticated defaults. In `auto` or `simple` mode, it can write config
without any browser profile settings.

The setup walkthrough configures:

- default strategy mode
- timeout and content validation thresholds
- fetch/jsdom/plugin/agent-browser fallbacks
- optional scrape.do plugin wiring
- authenticated browser profile defaults
- whether `agent-browser` waits for `networkidle` before extraction

### First-time authenticated setup

`agent-fetch` does not create browser sessions by itself. It passes a persistent
profile path to `agent-browser`, and `agent-browser` reuses that Chrome user-data
directory for authenticated requests.

```bash
# Install browser binaries once
agent-browser install

# Create or warm a persistent browser profile and log in once
agent-browser --profile ~/.agent-browser/profiles/work --headed open https://app.example.com/login

# After logging in, verify the same profile is authenticated
agent-browser --profile ~/.agent-browser/profiles/work open https://app.example.com/dashboard
```

Then save that profile for `agent-fetch`:

```bash
# Interactive
agent-fetch setup

# Non-interactive
AGENT_FETCH_PROFILE=~/.agent-browser/profiles/work \
agent-fetch setup --no-input --overwrite

# One-off authenticated fetch without saving defaults
agent-fetch fetch https://app.example.com/protected \
  --with-credentials \
  --profile ~/.agent-browser/profiles/work
```

If `--with-credentials` or `--strategy authenticated` is used and no profile is
configured, `agent-fetch` fails fast instead of silently falling back to
unauthenticated strategies.

### scrape.do quickstart

If you want a hosted fallback before browser automation, the fastest setup is:

```bash
SCRAPEDO_TOKEN=your-token \
AGENT_FETCH_ENABLE_PLUGINS=true \
agent-fetch setup --no-input --overwrite
```

That writes `SCRAPEDO_TOKEN` to `~/.agent-fetch/.env` and configures the built-in
`scrape-do` plugin in `~/.config/agent-fetch/config.json`.

You can also wire it manually:

```json
{
  "enablePlugins": true,
  "plugins": [
    {
      "type": "scrape-do",
      "token": "${SCRAPEDO_TOKEN}"
    }
  ]
}
```

```bash
SCRAPEDO_TOKEN=your-token agent-fetch fetch https://example.com --json --debug-attempts
```

### Plugins

```bash
agent-fetch plugins
agent-fetch plugins --json
agent-fetch plugins list
agent-fetch plugins list --json
```

## Configuration

Default config path:

- `~/.config/agent-fetch/config.json`
- override with `--config <path>` or `AGENT_FETCH_CONFIG_PATH`

Default shared env path:

- `~/.agent-fetch/.env`
- override with `AGENT_FETCH_SHARED_ENV_PATH` for runtime loading
- use `agent-fetch setup --env-file <path>` to write setup output somewhere else

The config file stores runtime defaults. The shared env file stores machine-specific values and secrets such as `AGENT_FETCH_PROFILE`, `AGENT_FETCH_AGENT_BROWSER_COMMAND`, and `SCRAPEDO_TOKEN`.

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
AGENT_FETCH_PROFILE=~/.agent-browser/profiles/work
AGENT_FETCH_AGENT_BROWSER_COMMAND=agent-browser
SCRAPEDO_TOKEN=your-token
```

`AGENT_FETCH_AGENT_BROWSER_COMMAND` is optional. Set it only when `agent-fetch`
should invoke something other than plain `agent-browser`, such as a wrapper
script or an absolute binary path. If you need extra flags, put them in the
wrapper script instead of the command string:

```bash
AGENT_FETCH_AGENT_BROWSER_COMMAND=/opt/bin/agent-browser-wrapper
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
- `AGENT_FETCH_PROFILE`
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

The package also exports `FetchError`, `registerPlugin()`, `listBuiltinPlugins()`, `parseCliArgs()`, `runCli()`, and the public fetch/plugin types if you want to embed the engine or reuse the CLI parser programmatically.

## Output contract (`--json`)

```json
{
  "url": "string",
  "title": "string",
  "author": "string | null",
  "content": "string",
  "outputMode": "markdown | primary | html | structured | screenshot",
  "screenshotPath": "string | null",
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

`content` always matches the selected output mode. `markdown` remains available in JSON output even when `--mode` is `primary`, `html`, `structured`, or `screenshot`, so callers can inspect both the selected output and the full-page markdown snapshot.

When `--mode structured` is used without `--json`, `content` is the pretty-printed JSON string for `structuredContent`.

When `--mode screenshot` is used, `content` and `screenshotPath` are the saved image path.

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
