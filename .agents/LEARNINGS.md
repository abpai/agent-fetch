# Learnings

## 2026-02-19
- Preserve `crawl()` behavior while simplifying internals; avoid changing fallback order or acceptance semantics.
- Reuse Playwright context only when header/user-agent settings are unchanged, otherwise recreate context to avoid stale request headers.
- Keep `User-Agent` consistent across fetch/jsdom/playwright paths by passing resolved headers into jsdom rendering.
- For app-server crawl workflows: store policy/default response modes in `AGENTS.md`, and keep executable command steps in `SKILL.md`.

## 2026-02-20
- For readability-only refactors in this repo, prefer extracting tiny helpers and reusing existing checks, then validate with both `pnpm test` and `pnpm lint`.
