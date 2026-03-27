# agent-fetch

`agent-fetch` is a robust fetch CLI for AI agents.

It tries the cheapest strategy first, then escalates when needed:

1. `fetch`
2. `jsdom`
3. configured plugins
4. `agent-browser`

Authenticated mode is explicit: `--with-credentials` jumps straight to `agent-browser` and fails fast if credentials are missing or invalid.

## Install

```bash
bun add @andypai/agent-fetch
```

## CLI

### Fetch

```bash
# Markdown output (default)
agent-fetch fetch https://example.com

# JSON output
agent-fetch fetch https://example.com --json

# Disable fallback stages
agent-fetch fetch https://example.com --no-jsdom --no-plugins

# Authenticated fast path (agent-browser only)
agent-fetch fetch https://example.com --with-credentials

# Force strategy mode
agent-fetch fetch https://example.com --strategy simple
agent-fetch fetch https://example.com --strategy authenticated
```

### Setup

```bash
# Guided setup
agent-fetch setup

# Non-interactive setup from env vars
AGENT_FETCH_CDP_PORT=9222 agent-fetch setup --no-input --overwrite
```

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

Example config:

```json
{
  "timeout": 30000,
  "enableFetch": true,
  "enableJsdom": true,
  "enablePlugins": true,
  "enableAgentBrowser": true,
  "strategyMode": "auto",
  "plugins": [
    {
      "type": "scrape-do",
      "token": "${SCRAPEDO_TOKEN}",
      "params": { "render": true }
    }
  ],
  "agentBrowser": {
    "cdpPort": "9222"
  }
}
```

### Legacy config behavior

Legacy config files are now rejected with a hard error:

- `.fetchrc.json`
- `fetch.config.json`

Move settings to `~/.config/agent-fetch/config.json`.

## Library usage

```ts
import { fetchUrl } from '@andypai/agent-fetch'

const result = await fetchUrl('https://example.com', {
  strategyMode: 'auto',
})

console.log(result.strategy)
console.log(result.markdown)
```

## Output contract (`--json`)

```json
{
  "url": "string",
  "title": "string",
  "author": "string | null",
  "markdown": "string",
  "html": "string",
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
