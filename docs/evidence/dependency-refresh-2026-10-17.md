# Dependency refresh — 2026-10-17

Maintenance update on `main`, based on `7e1294b`. This commit also includes the previously uncommitted [2026-10-06 refresh](dependency-refresh-2026-10-06.md), including its isolated native-test Keychain naming fix. Historical test results in that report remain dated and are not substituted for this verification.

## Versions and constraints

All npm workspace manifests, pnpm, used Go modules/test dependencies and external Docker images were checked against their official registries on 2026-10-17. Versions remain exact and images retain immutable manifest digests. Workspace package versions are unchanged because this maintenance does not complete a roadmap phase.

- Node 26.12.0, pnpm 12.14.0, Bun 1.4.3 and Go 1.27.2 agree across version files, engines, packageManager, go.mod and Dockerfile. Local verification uses ignored downloaded toolchains validated against official archive/GitHub asset SHA-256 digests; system-wide runtime installations are unchanged.
- Elysia remains on the approved 2.x beta line, updated to beta.32. Its npm `latest` tag points at 1.x, so blindly following that tag would downgrade the selected architecture.
- Latest LiveKit Go SDK 2.19.0 now supports protocol 1.52.1; the previous 1.50.4 compatibility constraint is removed. `go vet ./...` passed with that pair. Go upgrades used `go get -u all` and `go mod tidy`; unused upstream module graph entries were not promoted to direct dependencies.
- Two npm compatibility pins remain: landing TypeScript 6.0.3 (`@astrojs/check@0.9.10` accepts TypeScript 5/6) and API TypeScript 5.9.3 (`openapi-typescript@7.13.0` requires 5.x). Root TypeScript is latest 7.0.2. The latest peer metadata was rechecked; the prior report records the actual generator failure under 7.
- The 1440-minute npm release-age rule stays enabled. Expired October 6 exceptions were removed. Exact exceptions cover livekit-client 2.23.0, lucide-react 1.58.0, turbo 2.11.9 and its six matching platform binaries, which are required for the requested latest-version refresh. No wildcard or package-wide exemption was added.
- PostgreSQL 18.6 and Caddy 2.11.7 remain current stable versions. PostgreSQL 19 release-candidate images are excluded. Existing deployments and database volumes are not migrated by this source update.

## npm changes since the committed baseline

| Manifest                    | Package                 | Before        | After         |
| --------------------------- | ----------------------- | ------------- | ------------- |
| `package.json`              | `@shadcn/lint`          | 0.2.0         | 0.2.1         |
| `package.json`              | `@types/bun`            | 1.4.2         | 1.4.3         |
| `package.json`              | `@types/node`           | 24.10.1       | 26.6.5        |
| `package.json`              | `oxfmt`                 | 0.70.0        | 0.73.0        |
| `package.json`              | `oxlint`                | 1.85.0        | 1.88.0        |
| `package.json`              | `prettier`              | 3.9.9         | 3.9.10        |
| `package.json`              | `prettier-plugin-astro` | 1.1.0         | 1.1.1         |
| `package.json`              | `turbo`                 | 2.11.4        | 2.11.9        |
| `apps/landing/package.json` | `astro`                 | 7.3.5         | 7.4.0         |
| `apps/auth/package.json`    | `better-auth`           | 1.7.6         | 1.7.10        |
| `apps/auth/package.json`    | `elysia`                | 2.0.0-beta.19 | 2.0.0-beta.32 |
| `apps/auth/package.json`    | `pg`                    | 8.23.0        | 8.23.1        |
| `apps/web/package.json`     | `@base-ui/react`        | 1.8.0         | 1.9.0         |
| `apps/web/package.json`     | `livekit-client`        | 2.22.3        | 2.23.0        |
| `apps/web/package.json`     | `lucide-react`          | 1.48.0        | 1.58.0        |
| `apps/web/package.json`     | `react`                 | 19.3.0        | 19.3.1        |
| `apps/web/package.json`     | `react-dom`             | 19.3.0        | 19.3.1        |
| `apps/web/package.json`     | `@types/react`          | 19.2.2        | 19.3.0        |
| `apps/web/package.json`     | `@types/react-dom`      | 19.2.2        | 19.3.0        |
| `apps/web/package.json`     | `@vitejs/plugin-react`  | 6.1.1         | 6.1.2         |
| `apps/web/package.json`     | `happy-dom`             | 20.14.5       | 21.0.3        |
| `apps/web/package.json`     | `vite`                  | 8.3.1         | 8.3.4         |
| `apps/desktop/package.json` | `electron`              | 44.4.5        | 44.8.0        |
| `packages/ui/package.json`  | `@base-ui/react`        | 1.8.0         | 1.9.0         |
| `packages/ui/package.json`  | `@types/react`          | 19.2.2        | 19.3.0        |
| `packages/ui/package.json`  | `react`                 | 19.3.0        | 19.3.1        |

## Docker image pins

| Image                             | Manifest digest                                                           |
| --------------------------------- | ------------------------------------------------------------------------- |
| `node:26.12.0-bookworm-slim`      | `sha256:298992629d69bbd5b2b03ad57094d8e4fcb3a8eeb7c4e25d29de656519568913` |
| `oven/bun:1.4.3-slim`             | `sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288` |
| `golang:1.27.2`                   | `sha256:820153096fda4de6ac1b7194d12e416b7dd8f4e9a33d17e0345b111b945162d8` |
| `caddy:2.11.7-alpine`             | `sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f` |
| `postgres:18.6-alpine`            | `sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873` |
| `livekit/livekit-server:v1.13.10` | `sha256:89ca9ce0791e18d6e03bf6e2c49ceb27e1c754eae8bd50c989386c1a5963791a` |
| `haproxy:3.4.7-alpine`            | `sha256:251da69821897ec8c4819f12b1babbc4b71f562943addc9b9eb14bb6ece40dc6` |

## Startup readiness fix

The first fresh full-stack startup exposed an existing PostgreSQL readiness race. The Unix-socket `pg_isready -U postgres` check accepted the temporary database-initialization server while AUTH and Go migrations could not connect over TCP (`ECONNREFUSED` / database unavailable). The official PostgreSQL image entrypoint starts its temporary server with `listen_addresses=''`.

Both Compose healthchecks now explicitly use `pg_isready -h 127.0.0.1 -U postgres`. This gates migrations on the final TCP listener. The failed disposable database was removed and the installation was repeated from empty volumes; both migrations and the full stack then started successfully. No production database was touched.

## Verification

Executed on macOS arm64 with Node 26.12.0, pnpm 12.14.0, Bun 1.4.3, Go 1.27.2 and OrbStack:

- `pnpm install --frozen-lockfile` passed supply-chain checks. `pnpm peers check` reports no conflicts. `pnpm outdated -r --format json` lists only the two documented TypeScript pins; the latest stable 5.x/6.x versions were independently confirmed as 5.9.3/6.0.3.
- `pnpm check` passed formatting, Oxlint including configured shadcn rules, generated API consistency, strict types, isolated tests and all builds. The existing nonblocking Vite large-chunk warning remains.
- AUTH integration passed fresh-schema migration, closed signup, username login, real JWT/JWKS validation by Go, logout and internal current-session validation. The expected empty-schema diagnostic occurs before the tested migration.
- `scripts/test-server.ts` passed `go test -race -count=1 ./...` against disposable PostgreSQL 18.6 and LiveKit 1.13.10. `go vet ./...` and `go mod verify` passed with SDK 2.19.0/protocol 1.52.1.
- Docker BuildKit records show completed AUTH, Go and ingress builds with the current pinned images. A fresh full Compose installation passed setup/login, invitation-only admission/replay rejection, two guests, durable shared chat, concurrent retry deduplication, ban, session revocation and private-ingress checks after the readiness fix. The guest identity and committed message survived a container restart.
- `pnpm test:turn` passed HTTPS/TURN SNI routing, trusted/untrusted TLS, signaling credentials, invalid-credential rejection, authenticated bidirectional UDP relay, PROXY client address and restricted metadata-peer denial. An initial attempt aborted with Docker exit 130 during container creation while cold builds were active, before protocol probes ran; the clean retry after image builds completed passed all probes and cleanup.
- Native Electron 44.8.0 join and restore passed with the existing version-specific test application name: renderer sandbox/context isolation, absence of Node access, isolated guest cookies, selected-server restoration, actual OS encryption and rendered conversation after reload.

Container/native probes used protected ignored fixtures and fresh single-use invitations. The existing container test was copied with only result-file paths changed to preserve unrelated local evidence. Disposable containers, networks, volumes and local test credentials are removed after verification. System-wide runtimes and existing deployments are unchanged.

Public networking/TURN, actual two-person microphone conversation, signed installer behavior and Windows remain unverified. No roadmap stage is marked complete by this maintenance.

## Documentation sources

Context7 was used for pnpm update/release-age handling and LiveKit TURN configuration. Its LiveKit coverage refers to master; versioned 1.13.10 source and actual Docker probes are required for deployment evidence. Version selection uses npm registry metadata, the Go module proxy, [Node releases](https://nodejs.org/dist/index.json), [Go release metadata](https://go.dev/dl/?mode=json), [Bun releases](https://github.com/oven-sh/bun/releases), [LiveKit releases](https://github.com/livekit/livekit/releases), [PostgreSQL image entrypoint](https://github.com/docker-library/postgres/blob/master/docker-entrypoint.sh), [HAProxy 3.4 configuration](https://docs.haproxy.org/3.4/configuration.html) and Docker registry manifests.
