# Architecture

## Purpose

`agent-fetch` is a CLI-first fetch tool for AI agents.

It prioritizes low-cost extraction first and escalates only when needed, while keeping behavior scriptable and explicit.

## Primary Interface

- CLI binary: `agent-fetch`
- Core command: `agent-fetch fetch <url>`
- Supporting commands: `agent-fetch setup` (alias: `agent-fetch init`), `agent-fetch plugins list`
- Library API: `fetchUrl()`, `FetchError`, `registerPlugin()`, `listBuiltinPlugins()`

## Strategy Modes

- `auto` (default): `fetch -> jsdom -> plugins -> agent-browser`
- `simple`: `fetch` only
- `authenticated`: `agent-browser` only (same behavior as `--with-credentials`)

## Output Modes

- `markdown` (default): broad rendered-page markdown built from cleaned HTML
- `primary`: article-style primary content via Readability, with metadata fallback for non-article pages
- `html`: rendered HTML
- `structured`: structured sections, headings, and links derived from markdown; CLI text output is a JSON string for this mode

## Authenticated Fast Path

When `--with-credentials` is passed, `agent-fetch` skips all non-authenticated stages and directly runs `agent-browser` with CDP credentials.

If that fails, command exits non-zero with actionable error details and does not silently downgrade.

## Config and Environment

Config files:

- `~/.config/agent-fetch/config.json`
- optional override: `--config <path>` or `AGENT_FETCH_CONFIG_PATH`

Shared env file:

- `~/.config/agent-fetch/.env`
- optional override: `AGENT_FETCH_SHARED_ENV_PATH`

Precedence:

- CLI flags override environment variables
- environment variables override config file values
- config file values override built-in defaults

Credential keys:

- `AGENT_FETCH_CDP_PORT` (required for authenticated mode)
- `AGENT_FETCH_CDP_LAUNCH` (optional fallback launcher)

Legacy files are hard-rejected:

- `.fetchrc.json`
- `fetch.config.json`

## Module Map

- `src/index.ts`
  - Bun entrypoint
  - exports CLI and library API
- `src/cli/index.ts`
  - command parsing (`fetch`, `setup`, `plugins list`)
- `src/cli/commands/fetch.ts`
  - runtime config + fetch engine execution
- `src/cli/commands/setup.ts`
  - guided/non-interactive setup for CDP credentials and defaults
- `src/cli/commands/plugins.ts`
  - built-in plugin discovery output
- `src/core/fetch-engine.ts`
  - strategy orchestration and attempt tracking
  - authenticated fast path and acceptance-driven escalation
- `src/core/acceptance.ts`
  - threshold + blocked/paywall checks used to reject weak results and continue fallback
- `src/core/extract.ts`
  - full-page markdown extraction via cleaned HTML + Kreuzberg
  - primary extraction via Readability + Turndown
  - structured output assembly for section-aware consumers
- `src/strategies/`
  - `fetch.ts`, `jsdom.ts`, `agent-browser.ts`
- `src/plugins/`
  - built-ins, registry, plugin interfaces
- `src/config/loader.ts`
  - config discovery, env merging, legacy detection

## Error Model

- Fetch failures throw `FetchError` with per-strategy `attempts[]`.
- CLI prints actionable errors to `stderr` and returns non-zero exit.
- `stdout` remains reserved for the selected content output (`markdown`, `primary`, `html`, `structured`) or JSON.
- `--debug-attempts` prints per-attempt diagnostics to `stderr` on success too.

## Plugin Model (v1)

- Built-ins + local register API only (`registerPlugin`)
- No dynamic npm plugin auto-loading
- Plugin config supports `${ENV_VAR}` interpolation
- Built-in discovery surface today is `plugins list`, currently exposing `scrape-do`
