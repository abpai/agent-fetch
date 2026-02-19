# Learnings

## 2026-02-19
- Preserve `crawl()` behavior while simplifying internals; avoid changing fallback order or acceptance semantics.
- Reuse Playwright context only when header/user-agent settings are unchanged, otherwise recreate context to avoid stale request headers.
- Do not treat empty page titles as auto-blocked in queue filtering; blank titles are common in browser history exports.
- Do not auto-block all homepage URLs (`/`) in queue generation; this discards useful seed URLs.
- Keep queue management deterministic and CLI-driven via `data/url_queue.json` for agent workflows.
- `scripts/url-history.ts` writes generation stats (`total_items`, `unique_kept`, `blocked_items`, `blocked_by_reason`); queue size is derived from `urls.length`.
- `scripts/queue-cli.mjs` computes `queue_size` for display in `stats` and persists `queue_remaining` only on mutating commands via `saveQueue`.
- `queue-cli` command parsing must treat non-numeric `list/peek/pop` first args as `queueFile` paths to match the documented `[count] [queueFile]` signature.
- Keep `User-Agent` consistent across fetch/jsdom/playwright paths by passing resolved headers into jsdom rendering.
