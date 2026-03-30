# Architecture

## Purpose

`agent-fetch` is a CLI-first fetch tool for AI agents.

It prioritizes low-cost extraction first and escalates only when needed, while keeping behavior scriptable and explicit.

## Primary Interface

- CLI binary: `agent-fetch`
- Core command: `agent-fetch fetch <url>`
- Supporting commands: `agent-fetch setup` (alias: `agent-fetch init`), `agent-fetch plugins` (shorthand for `agent-fetch plugins list`)
- Library API: `fetchUrl()`, `FetchError`, `registerPlugin()`, `listBuiltinPlugins()`, `parseCliArgs()`, `runCli()`, plus public fetch/plugin types

## Strategy Modes

- `auto` (default): `fetch -> jsdom -> plugins -> agent-browser`
- `simple`: `fetch` only
- `authenticated`: `agent-browser` only (same behavior as `--with-credentials`)

## Output Modes

- `markdown` (default): broad rendered-page markdown built from cleaned HTML
- `primary`: article-style primary content via Readability, with metadata fallback for non-article pages
- `html`: rendered HTML
- `structured`: structured sections, headings, and links derived from markdown; CLI text output is a JSON string for this mode
- `screenshot`: full-page screenshot path captured through `agent-browser`

## Exact Method Override

- `--method fetch`: run only the plain fetch strategy
- `--method jsdom`: fetch once, then run only jsdom rendering
- `--method agent-browser`: run only agent-browser
- `--method scrape.do`: run only that configured plugin (normalized internally to `scrape-do`)
- `--mode screenshot` is a special case that always routes through `agent-browser`

## Authenticated Fast Path

When `--with-credentials` is passed, `agent-fetch` skips all non-authenticated stages and directly runs `agent-browser` with a persistent browser profile (`AGENT_FETCH_PROFILE` or `--profile`).

If that fails, command exits non-zero with actionable error details and does not silently downgrade.

## Config and Environment

Config files:

- `~/.config/agent-fetch/config.json`
- optional override: `--config <path>` or `AGENT_FETCH_CONFIG_PATH`

Shared env file:

- `~/.agent-fetch/.env`
- optional runtime override: `AGENT_FETCH_SHARED_ENV_PATH`
- optional setup write path: `agent-fetch setup --env-file <path>`

Precedence:

- CLI flags override environment variables
- environment variables override config file values
- config file values override built-in defaults

Credential keys:

- `AGENT_FETCH_PROFILE` (required for authenticated mode unless `--profile` is passed)
- `AGENT_FETCH_AGENT_BROWSER_COMMAND` (optional command override)

Legacy files are hard-rejected:

- `.fetchrc.json`
- `fetch.config.json`

## Module Map

- `src/index.ts`
  - Bun entrypoint
  - exports CLI and library API
- `src/cli/index.ts`
  - command parsing (`fetch`, `setup`/`init`, `plugins`/`plugins list`)
- `src/cli/commands/fetch.ts`
  - runtime config + fetch engine execution
- `src/cli/commands/setup.ts`
  - guided/non-interactive setup for browser profile defaults and runtime settings
- `src/cli/commands/plugins.ts`
  - built-in plugin discovery output
- `src/core/fetch-engine.ts`
  - strategy orchestration and attempt tracking
  - exact-method execution (`--method`) and screenshot routing
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
- `stdout` remains reserved for the selected content output (`markdown`, `primary`, `html`, `structured`, `screenshot`) or JSON.
- `--debug-attempts` prints per-attempt diagnostics to `stderr` on success too.

## Plugin Model (v1)

- Built-ins + local register API only (`registerPlugin`)
- No dynamic npm plugin auto-loading
- Plugin config supports `${ENV_VAR}` interpolation
- Built-in discovery surface today is `plugins` / `plugins list`, currently exposing `scrape-do`
