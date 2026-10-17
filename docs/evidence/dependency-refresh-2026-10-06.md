# Dependency refresh — 2026-10-06

Working-tree update on `main`, based on `7e1294b`. This is a dependency maintenance change; it does not complete Stage 1 or later acceptance gates. No application behavior or protocol contract was intentionally changed.

## Selection and compatibility

Queried npm dist-tags, Go module proxy, official Node/Go downloads, upstream release APIs and Docker registry manifest digests on 2026-10-06. Stable releases are selected, except the explicitly approved Elysia 2 beta line. `elysia@latest` points to 1.4.30; the latest Elysia 2 release is 2.0.0-beta.22, so no downgrade to 1.x was performed.

Node moves from 24.20.0 to 26.10.0 and pnpm from 12.6.0 to 12.9.1. `.node-version`, root engines/packageManager and the Docker build stage agree. Verification uses an ignored local Node 26.10.0 archive validated against upstream SHA-256; it does not replace the machine's global Node. Bun 1.4.2 and Go 1.27.1 remain the latest stable releases queried. The Go image has a refreshed immutable manifest digest even though its version is unchanged. PostgreSQL remains on stable major 18; 19 beta images are excluded.

All npm dependencies were checked. Latest compatible versions are retained for three upstream constraints:

- Landing TypeScript stays 6.0.3: `@astrojs/check@0.9.10` requires TypeScript 5 or 6, not 7.
- API generation TypeScript stays 5.9.3: `openapi-typescript@7.13.0` requires 5.x. Installing 7.0.2 failed at `ts.factory.createKeywordTypeNode`; this is a tested incompatibility.
- Go `github.com/livekit/protocol` moves to 1.50.4, not latest 1.52.1. The latest released server SDK is 2.18.1; protocol 1.51+ changes TransferSIPParticipant from protobuf Empty to TransferSIPParticipantResponse and breaks compilation inside that SDK. Both versions' generated RPC signatures were inspected. No vendored patch or untagged SDK commit is used.

Used Go module dependencies and their test dependencies were refreshed with `go get -u ./...`, `go get -u all` and `go mod tidy`, retaining the protocol compatibility constraint. Unused upstream module-graph entries are not promoted to direct dependencies solely to update their versions. CEL's new module path `cel.dev/cel-go` is resolved by the upgraded validation dependencies; the old github.com/google/cel-go path cannot consume 0.32.0 because its module declaration changed.

The 1440-minute pnpm release-age protection stays enabled. Exact exclusions cover only the five new releases needed for this refresh: Astro 7.3.6, its internal-helpers 0.12.0 and markdown-satteri 0.4.3 dependencies, Elysia 2 beta.22 and Vite 8.3.3. No package-wide or wildcard exception was added. Install passed pnpm's supply-chain verification.

## npm changes

| Manifest                    | Package                | Before        | After         |
| --------------------------- | ---------------------- | ------------- | ------------- |
| `package.json`              | `@types/node`          | 24.10.1       | 26.6.4        |
| `package.json`              | `oxfmt`                | 0.70.0        | 0.72.0        |
| `package.json`              | `oxlint`               | 1.85.0        | 1.87.0        |
| `package.json`              | `turbo`                | 2.11.4        | 2.11.7        |
| `apps/landing/package.json` | `astro`                | 7.3.5         | 7.3.6         |
| `apps/auth/package.json`    | `better-auth`          | 1.7.6         | 1.7.7         |
| `apps/auth/package.json`    | `elysia`               | 2.0.0-beta.19 | 2.0.0-beta.22 |
| `apps/auth/package.json`    | `pg`                   | 8.23.0        | 8.23.1        |
| `apps/web/package.json`     | `lucide-react`         | 1.48.0        | 1.52.0        |
| `apps/web/package.json`     | `@types/react`         | 19.2.2        | 19.3.0        |
| `apps/web/package.json`     | `@types/react-dom`     | 19.2.2        | 19.3.0        |
| `apps/web/package.json`     | `@vitejs/plugin-react` | 6.1.1         | 6.1.2         |
| `apps/web/package.json`     | `vite`                 | 8.3.1         | 8.3.3         |
| `apps/desktop/package.json` | `electron`             | 44.4.5        | 44.5.1        |
| `packages/ui/package.json`  | `@types/react`         | 19.2.2        | 19.3.0        |

## Pinned images

| Image                            | Manifest digest                                                           |
| -------------------------------- | ------------------------------------------------------------------------- |
| `node:26.10.0-bookworm-slim`     | `sha256:3ffc19ea878019d9e9ae8971732ad4a03cda44f167107173174b60ed7c65bed3` |
| `oven/bun:1.4.2-slim`            | `sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61` |
| `golang:1.27.1`                  | `sha256:162be5298a40ed317005c8339c6de4d10d3eef336d66dc8e9259b03ab9d3a6d2` |
| `caddy:2.11.7-alpine`            | `sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f` |
| `postgres:18.6-alpine`           | `sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873` |
| `livekit/livekit-server:v1.13.8` | `sha256:ad961c9b4b064298cc08d618d772671f7c783e036001388079fa813929cc357e` |
| `haproxy:3.4.6-alpine`           | `sha256:7af8255207ee9964ccb4eec8ce4b7a40b777769665e3ae83897fb01b24d8a43a` |

## Verification

Executed on macOS arm64 with Node 26.10.0, pnpm 12.9.1, Bun 1.4.2, Go 1.27.1 and OrbStack:

- `pnpm install --frozen-lockfile` passed; `pnpm peers check` reports no conflicts. `pnpm outdated -r --format json` reports only the two documented TypeScript compatibility pins.
- `pnpm check` passed: Oxfmt/Prettier, Oxlint including configured shadcn rules, generated API consistency, strict types, isolated tests and all builds. Vite retains a nonblocking large-chunk warning; bundle-size optimization is outside this refresh.
- AUTH integration on a fresh disposable PostgreSQL 18.6 database passed migrations, closed signup, username login, JWT/JWKS verification from Go, logout and internal session validation. Its initial missing-schema diagnostic precedes the tested migration and is expected for an empty database.
- `scripts/test-server.ts` passed `go test -race -count=1 ./...` against the new PostgreSQL and LiveKit images after the final module update.
- All application images built using the pinned new base images. The full disposable Compose installation passed owner setup/login, single-use invitations, two guests, shared durable chat, concurrent retry deduplication, authorization, ban, revoked JWT and private ingress. Guest identity and committed history survived a container restart. The existing container smoke script was copied into an ignored fixture changing only result-file paths to avoid overwriting unrelated local evidence.
- `pnpm test:turn` passed trusted/untrusted TLS, HTTPS/TURN SNI routing, signaling-issued credentials, wrong-credential rejection, authenticated bidirectional relay, PROXY client address and restricted-peer denial on LiveKit 1.13.8, HAProxy 3.4.6 and Pion TURN 5.1.2.
- Native Electron 44.5.1 join and restore passed: renderer sandbox/context isolation, absence of Node access, guest-cookie boundary, selected-server restoration, actual OS encryption and rendered conversation after reload.

The initial native probe timed out waiting for `safeStorage.isAsyncEncryptionAvailable` under the generic Electron app name. The cached 44.4.5 baseline probe passed; 44.5.1 passed with an isolated app name. This is consistent with unsigned runtime builds sharing the generic Electron Keychain item and triggering access/signature differences. The smoke harness now uses `Yapper Native Smoke <Electron version>` before app readiness; both phases use the same name. It preserves real OS encryption and avoids modifying the product's credential-storage behavior. No security preference or TLS validation was relaxed.

Disposable integration and full-stack test containers/volumes are removed after verification; TURN and native harness fixtures clean themselves up. No existing deployment or database was updated. Public media/TURN, real two-person microphone conversation, signed installer behavior and native Windows remain unverified. These results are maintenance evidence, not completion of any roadmap stage.

## References

[Node releases](https://nodejs.org/dist/index.json), [Go releases](https://go.dev/dl/?mode=json), [pnpm update](https://pnpm.io/cli/update), [exact release-age exemptions](https://pnpm.io/blog/releases/10.19), [Elysia 2](https://elysiajs.com/blog/elysia-20), [LiveKit 1.13.8](https://github.com/livekit/livekit/releases/tag/v1.13.8), [LiveKit protocol 1.50.4 RPC](https://github.com/livekit/protocol/blob/v1.50.4/livekit/livekit_sip.twirp.go), [LiveKit protocol 1.51 RPC](https://github.com/livekit/protocol/blob/v1.51.0/livekit/livekit_sip.twirp.go), [HAProxy 3.4 manual](https://docs.haproxy.org/3.4/configuration.html), [PostgreSQL 18.6 release notes](https://www.postgresql.org/docs/release/18.6/).

Context7 was used for pnpm update/release-age behavior, Elysia 2/Better Auth mounting and LiveKit TURN configuration. Version coverage was incomplete for Elysia beta.22 and LiveKit 1.13.8; registry metadata, versioned LiveKit TURN source and actual integration tests resolve those gaps. Historical evidence files retain their original executed versions.
