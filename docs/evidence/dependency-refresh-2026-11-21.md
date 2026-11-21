# Dependency refresh — 2026-11-21

Maintenance update based on local `main` at `15e2f6a`. Version selection used the npm registry, Go Proxy, official runtime release indexes, and Docker Hub. This update applies to repository inputs and test installations.

## Toolchain and dependency selection

- Node.js 26.13.1 LTS, Bun 1.4.5, Go 1.27.4, and pnpm 12.21.0 are pinned across the repository and build images. The Node.js 27 releases available at review time were alpha builds.
- The refresh updated 22 direct npm declarations and refreshed compatible transitive packages in `pnpm-lock.yaml`. Notable changes include Electron 45.4.1, Astro 7.4.13, Vite 8.3.8, Tailwind CSS 4.3.5, Better Auth 1.7.27, LiveKit JS 2.25.0, Oxlint 1.94.0, and Oxfmt 0.79.0.
- Elysia 2.0.0-rc.3 is the newest published release candidate on the existing 2.x line. The npm `latest` tag still resolves to 1.x. Astro keeps TypeScript 6.0.3 for the `@astrojs/check` peer range, and the OpenAPI package keeps TypeScript 5.9.3 for `openapi-typescript`. The root uses TypeScript 7.0.2.
- pnpm's 24-hour release-age check stays enabled. Exact exclusions cover the newly published direct releases and the seven Better Auth packages required at 1.7.27.
- Go modules were updated with `go get -u all` and `go mod tidy`. LiveKit SDK 2.20.0 uses protocol 1.54.1 in this project. The SDK's pinned WebRTC and ICE forks use the DTLS v4 API. Unmodified upstream Pion WebRTC still expects DTLS v3, and the SDK's fork fails to compile against DTLS v4.0.2. The application module mirrors the SDK's WebRTC and ICE replacements and selects DTLS v4.0.0-rc.8. Remove these compatibility pins once a newer SDK and Pion combination builds and passes integration tests.

## Docker images

The Dockerfile frontend and all third-party build and runtime images use pinned manifest digests.

| Component           | Version               |
| ------------------- | --------------------- |
| Dockerfile frontend | 1.29.0                |
| Node build image    | 26.13.1-bookworm-slim |
| Bun runtime         | 1.4.5-slim            |
| Go build image      | 1.27.4                |
| Caddy               | 2.11.9-alpine         |
| PostgreSQL          | 19.0-alpine           |
| LiveKit server      | 1.13.11               |
| HAProxy             | 3.4.8-alpine          |

PostgreSQL 19 is a major-version change. [Operations](../operations.md#updates-and-backups) records how existing PostgreSQL 18 installations are handled before changing images. Local checks use fresh disposable volumes. The project has no existing database to migrate.

## Verification

Executed on macOS arm64 with the pinned runtimes, Docker Compose 5.5.0, and OrbStack Docker Engine 29.8.2.

- `pnpm install --frozen-lockfile` and `pnpm peers check` passed. `pnpm outdated` reported the two documented TypeScript compatibility pins.
- `pnpm check` passed formatting, Oxlint with shadcn rules, OpenAPI generation, type checks, isolated tests, and builds. Vite still reports its nonblocking chunk-size warning.
- `go mod verify` and `go vet ./...` passed. AUTH and Go integration tests against PostgreSQL 19 and LiveKit 1.13.11 passed, including database initialization, login, JWT/JWKS verification, logout, and the Go race suite.
- The AUTH, Go and ingress images built. A fresh Compose smoke test passed setup, login, guest admission, durable chat, retry deduplication, ban and session revocation. Guest identity and message history survived restarting PostgreSQL, AUTH and Go.
- `pnpm test:turn` passed TLS routing, trusted certificate checks, authenticated TURN relay and peer policy. Electron 45.4.1 passed the native macOS development join and restore scenarios with an isolated renderer and OS-encrypted credentials.

Public networking, two-person microphone calls, and desktop release installers remain outside this verification. The refresh leaves Stage 1 in acceptance.

## Bun tooling follow-up

- Stage 1 uses Bun 1.4.5 for `pnpm format` and `pnpm format:check`, including formatting generated OpenAPI types. The `oxfmt` package was removed. Bun's `oxfmt` formatting style keeps the existing output, and Prettier continues to handle `.astro` files.
- Bun 1.4.5 has no built-in `lint` command. Outside the workspace it reports `Script not found "lint"`, and inside the workspace `bun lint` runs the package's existing lint script.
- The separately downloaded Bun `1.4.6-canary.1+98eae327f` passed a repository lint run using `.oxlintrc.json` and `--max-warnings 0`. Its `--doctor` registered all four configured `@shadcn/lint` rules. A temporary TSX fixture confirmed that both linters reject raw colors, arbitrary values, and inline styles. The team decided to keep Oxlint. Migration to Bun lint is off the current roadmap.
- After switching the formatter, `pnpm install --frozen-lockfile`, `pnpm peers check`, and `pnpm check` passed. OpenAPI generation produced the same checked-in types. The updated images built and a fresh PostgreSQL 19 Compose smoke test passed setup, restart and persistence, and native Electron join and restore.

## References

- [Node.js release archive](https://nodejs.org/en/about/previous-releases), [Bun 1.4.5](https://bun.com/blog/bun-v1.4.5), [Go downloads](https://go.dev/dl/), and [pnpm releases](https://pnpm.io/blog/releases/12.21.0)
- [LiveKit Go SDK v2.20.0 module](https://github.com/livekit/server-sdk-go/blob/v2.20.0/go.mod) and [LiveKit WebRTC fork module](https://github.com/livekit/webrtc-pion/blob/v4.2.25-warp.3/go.mod)
- [PostgreSQL 19 release notes](https://www.postgresql.org/docs/release/19.0/)
- [Bun formatter](https://bun.com/docs/format) and [Bun linter](https://bun.com/docs/lint)
