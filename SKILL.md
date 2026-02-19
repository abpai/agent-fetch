---
name: crawl-queue-cli
description: Manage URL queues for this repository from the command line. Use when an agent needs to generate `data/url_queue.json` from browser history exports, inspect queue state, pop or peek URLs for workers, enqueue or remove URLs, or tune URL filtering inputs in `data/blacklist_domains.txt` and `data/url_filters.json`.
---

# Crawl Queue CLI

Use this workflow to build and operate the queue consumed by crawler workers.

## Run Queue Generation

1. Place browser history exports (`*.json`) inside `data/`.
2. Optionally add `data/blacklist_domains.txt` with one domain suffix per line.
3. Optionally add `data/url_filters.json` with:
   - `blocked_host_suffixes`
   - `blocked_host_keywords`
   - `tracking_params`
4. Run:

```bash
pnpm run queue:generate
```

Generate `data/url_queue.json` with sorted URL priority entries.

## Operate Queue from CLI

Run:

```bash
pnpm run queue:stats
pnpm run queue:list
pnpm run queue:peek -- 5
pnpm run queue:pop -- 10
node scripts/queue-cli.mjs enqueue https://example.com/article "Manual add"
node scripts/queue-cli.mjs remove https://example.com/article
```

Use `pop` to claim work for a worker.  
Use `peek` to inspect without mutating.

## Verify After Changes

1. Run `pnpm run queue:generate`.
2. Run `pnpm run queue:stats`.
3. Run `pnpm run queue:peek -- 3`.
4. Confirm `data/url_queue.json` remains valid JSON and queue size changes as expected after `pop`/`enqueue`/`remove`.

## Guardrails

- Keep queue operations file-based; do not introduce hidden state.
- Preserve the `urls` array structure used by workers.
- Prefer queue CLI commands over hand-editing `data/url_queue.json`.
