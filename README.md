# Yapper

Self-hosted conversations. Independent accounts, durable chat, attachments, voice, camera and screen sharing.

Implementation is in progress. See [roadmap](docs/ROADMAP.md) and [delivery ledger](docs/PROGRESS.md) for verified scope. Open pull requests are not released software.

## Workspace

- `server`: Go application and PostgreSQL persistence.
- `apps/web`: React/TypeScript client shared with Electron.
- `apps/desktop`: Windows/Linux desktop integration.
- `apps/landing`: standalone Astro site.
- `deploy`: container deployment resources.
- `docs`: architecture, operations and delivery evidence.

## Development

Use Node 24, pnpm 12 and Go 1.26. Docker Compose runs integration dependencies. Run `pnpm install`, `pnpm build`, `pnpm typecheck`; server checks run with `cd server && go test ./...`. For real PostgreSQL integration and race checks, use `python3 scripts/test-server.py`.

Do not commit credentials or local data. Local settings belong in ignored `.env` files.

## Candidate 0.5.0

Follow [self-hosting](docs/SELF_HOSTING.md), [user guide](docs/USER_GUIDE.md) and [feature matrix](docs/FEATURE_MATRIX.md). Local development in this workspace is running at http://127.0.0.1:18088. This loopback address is not a public deployment.

Implementation through F05 is submitted as stacked open pull requests. Physical device/group and WAN/TURN acceptance remains outstanding; no release has been published.
