---
name: agent-fetch
description: Use agent-fetch to fetch robust page content for AI agents with staged fallbacks and authenticated browser mode.
---

# agent-fetch

Use this workflow when an agent needs clean markdown or structured JSON from a URL.

## Core command

```bash
# Markdown output
agent-fetch fetch https://example.com

# JSON output
agent-fetch fetch https://example.com --json
```

## Strategy controls

```bash
# Default mode: fetch -> jsdom -> plugins -> agent-browser
agent-fetch fetch https://example.com

# Cheapest only
agent-fetch fetch https://example.com --strategy simple

# Authenticated only (fail-fast)
agent-fetch fetch https://example.com --with-credentials
# equivalent
agent-fetch fetch https://example.com --strategy authenticated
```

## Setup (credentials + defaults)

```bash
# Interactive
agent-fetch setup
# alias
agent-fetch init

# Non-interactive
AGENT_FETCH_CDP_PORT=9222 agent-fetch setup --no-input --overwrite
```

`setup` writes (by default):

- `~/.config/agent-fetch/config.json`
- `~/.config/agent-fetch/.env`

## Plugins

```bash
agent-fetch plugins list
agent-fetch plugins list --json
```

## Guardrails

- For `fetch`, `stdout` is reserved for primary output (markdown or JSON).
- For `fetch`, errors and debug attempt details go to `stderr`.
- Legacy config files (`.fetchrc.json`, `fetch.config.json`) are rejected with a hard error.
- `--with-credentials` never silently downgrades to non-authenticated strategies.
