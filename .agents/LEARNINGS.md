# Learnings

## 2026-02-19
- Preserve `crawl()` behavior while simplifying internals; avoid changing fallback order or acceptance semantics.
- Reuse Playwright context only when header/user-agent settings are unchanged, otherwise recreate context to avoid stale request headers.
- Keep `User-Agent` consistent across fetch/jsdom/playwright paths by passing resolved headers into jsdom rendering.
- For app-server crawl workflows: store policy/default response modes in `AGENTS.md`, and keep executable command steps in `SKILL.md`.

## 2026-02-20
- For readability-only refactors in this repo, prefer extracting tiny helpers and reusing existing checks, then validate with both `pnpm test` and `pnpm lint`.

## 2026-02-21
- For large architecture migrations in this repo, stage work as: module scaffolding -> command wiring -> docs/scripts -> tests; this keeps failures localized and easier to resolve.
- In this environment, avoid parallel tool calls for dependent file creation (race risk); do dependent edits sequentially.
- Prefer `bun-types` directly for Bun typing when `tsconfig` uses `\"types\": [\"bun-types\"]`.
- Avoid wrapping intentionally thrown `FetchError` in strategy catch blocks; otherwise attempt logs get duplicated with synthetic \"All fetch strategies failed\" entries.
- Lower default minimum word count to avoid rejecting legitimate short pages (e.g. `example.com`) in simple mode.
- For readability refactors in this codebase, extract small shared helpers (`recordErrorAttempt`, `runCheckedCommand`, env value builders) rather than broad rewrites; this keeps behavior stable while reducing duplication.
- When using Bun test runner in repos that keep compiled output (`dist/`), scope tests to `src/` (e.g., `bun test src`) to avoid accidentally executing stale compiled tests.
- Keep Bun migration consistent end-to-end: remove Vitest config/dependency, migrate tests to `bun:test`, and align pre-commit hooks/scripts to `bun run`.
- In docs, scope stdout/stderr guarantees to `fetch` command behavior rather than the entire CLI, since `setup` uses interactive terminal output.
- For Bun bundling in this repo, set `bun build` to `--target bun` because `jsdom` depends on Node builtins that fail under Bun's default browser-target build.
- In setup flows, `--overwrite` should truly replace generated config defaults; merging existing config preserves stale plugin entries and defeats the overwrite contract.

## 2026-03-26
- For Bun CLI setup wizards across related repos, prefer the Orb-style pattern: explicit TTY guard, shared cancel/trim helpers, env-backed defaults, overwrite confirmation per file, and dedicated setup tests for both interactive and non-interactive paths.
- For dead-code audits in this repo, treat `src/index.ts` exports as external package surface unless proven otherwise; several internal exports are removable, but top-level package exports are not.
- `waitForNetworkIdle` is currently a config/setup surface without a matching runtime branch in the fetch strategies, so treat it as a live correctness gap rather than dead code.
- When `package.json` changes in this repo, sync `bun.lock` in the same change; `bun install --frozen-lockfile` is part of CI and will fail even if local commands pass.
- In the setup wizard, a prompt that asks whether to configure a section should preserve current values when the user skips that section instead of clearing previously saved thresholds.
- For Next.js or SPA shell pages in this repo, Readability can lock onto footer/legal text; when that happens and the page has a clean meta description, prefer that metadata summary over boilerplate output.
- For homepage and portal-style pages in this repo, make full-page markdown the default extraction product and keep Readability as an explicit `primary` mode; markdown conversion quality matters less than choosing the right default content shape.

## 2026-03-27
- `waitForNetworkIdle` now has a live runtime effect in `src/strategies/agent-browser.ts`; keep docs scoped to that strategy-specific behavior instead of describing it as a generic fetch-wide switch.
- When refreshing docs in this repo, verify and document the library exports as well as the CLI surface; `src/index.ts` is part of the public contract.
