# Yapper

Self-hosted conversations. Independent accounts, durable chat and voice rooms.

Implementation is in progress. See [roadmap](docs/ROADMAP.md) and [delivery ledger](docs/PROGRESS.md) for verified scope. Open pull requests are not released software.

## Workspace

- `server`: Go application and PostgreSQL persistence.
- `apps/web`: React/TypeScript client shared with Electron.
- `apps/desktop`: Windows/Linux desktop integration.
- `apps/landing`: standalone Astro site.
- `deploy`: container deployment resources.
- `docs`: architecture, operations and delivery evidence.

## Development

Use Node 24, pnpm 12 and Go 1.26. Docker Compose runs integration dependencies. Run `pnpm install`, `pnpm build`, `pnpm typecheck`; server checks run with `cd server && go test ./...`. Commands become available as the corresponding stage lands.

Do not commit credentials or local data. Local settings belong in ignored `.env` files.
