# Repository Guidelines

## Project Structure & Module Organization

- `src/` holds the TypeScript source: server entry (`server.ts`), Fastify app wiring (`app.ts`), CLI (`cli.ts`), services (`services/`), route modules (`modules/`), middleware, config, and shared utilities.
- `scripts/` contains one-off tooling such as history import helpers.
- `tests/` exists for Vitest suites (currently empty).
- `storage/` and `data/` are runtime persistence/fixtures; keep generated artifacts out of source control unless explicitly required.
- `dist/` is the build output produced by `pnpm build`.

## Build, Test, and Development Commands

- `pnpm dev`: run the API server in watch mode via `tsx`.
- `pnpm cli -- <cmd>`: run the CLI (e.g., `pnpm cli -- stats`).
- `pnpm build`: bundle to `dist/` using `build.mjs`.
- `pnpm start`: run the production build (`dist/server.js`).
- `pnpm test`: run Vitest.
- `pnpm lint` / `pnpm format`: ESLint and Prettier checks.
- `docker compose up -d`: run the containerized stack.
- `npx playwright install chromium`: install the browser dependency for crawling.

## Coding Style & Naming Conventions

- TypeScript, ESM modules (`"type": "module"`).
- Format with Prettier; lint with ESLint (`eslint.config.js`). Run `pnpm format` before submitting changes.
- Prefer clear, descriptive names aligned with existing patterns (e.g., `*.service.ts`, `routes.ts`, `cli.ts`).
- Unused variables should be prefixed with `_` to satisfy lint rules.

## Testing Guidelines

- Test runner: Vitest (`vitest.config.ts`, Node environment, globals enabled).
- Place tests in `tests/` or alongside source with `*.test.ts`/`*.spec.ts` naming.
- No coverage thresholds are enforced yet; add coverage if you introduce critical logic.

## Commit & Pull Request Guidelines

- This repository has no prior commits, so no commit-message convention is established yet. Use concise, imperative messages (e.g., “Add crawler retry backoff”).
- PRs should include: a clear description, test/verification steps, and screenshots for UI changes (dashboard routes).
- Link related issues or notes when applicable.

## Security & Configuration Tips

- Environment configuration is handled via `.env` (`dotenv` is a dependency). Keep secrets out of the repo.
- Playwright/Chromium is required for crawling; verify local installs match CI/Docker expectations.
