# Stage 1 implementation checkpoint

Date: 2026-09-29. Source: `feat/implement-first-conversation`, based on foundation commit `633f439`. **Implemented for review; the Stage 1 acceptance gate has not passed.** No 0.5.0 release is claimed. Stages 2–8 have not started. The approved Stage 0–8 plan is authoritative; the retired roadmap's F01–F05 version mapping is not silently reused.

## Implemented behavior

- One-time, expiring host setup provisions the owner through private AUTH APIs. PostgreSQL locking serializes setup and invitation redemption. Public account registration is closed.
- Owner username/password login uses Elysia 2 Beta, Better Auth and Bun. Go verifies JWT/JWKS and checks the current AUTH session through a private authenticated API. Logout invalidates subsequent API access; active connections recheck authorization.
- Invitation-only guest admission creates a persistent opaque credential. Web uses an HttpOnly cookie; localStorage holds only language preference. The initial owner can issue one-use, 24-hour invitations and ban participants.
- A text channel persists messages before acknowledgement/broadcast. Request UUIDs deduplicate concurrent retries; payload conflicts fail. HTTP history and WebSocket reconnect reconcile by committed sequence and message ID.
- A voice channel uses self-hosted LiveKit, microphone-only grants and per-connection identities. Go gates signaling against current membership/session state. Bans close tracked signaling and remove the participant. A stale session-specific leave cannot revoke a newer session. Mute/deafen, participant/speaking state and connection indicators exist in EN/PL.
- Electron bundles the renderer, exposes narrow server-selection IPC, and proxies requests through a nonce-protected loopback gateway. Main-process cookie jars are isolated by full server origin and persisted using OS encryption. Navigation, renderer cookie exposure and proxy redirects are restricted.
- Compose builds AUTH, Go and ingress images and runs PostgreSQL, LiveKit and migrations. Go and AUTH own separate databases/roles. LiveKit signaling is private; public signaling goes through the Go admission gate. Shared OpenAPI-generated TypeScript contracts and Base UI components are present.

## Executed evidence

Environment: macOS 27.0.1 arm64, Node 24.20.0, pnpm 12.6.0, Bun 1.4.2, Go 1.27.1; Docker Engine 29.4 through OrbStack. LiveKit server 1.13.7, Go SDK 2.18.1, JS SDK 2.22.3; Electron 44.4.5. Exact dependency/image pins are in the lockfile and Compose/Dockerfile.

- Foundation local checks passed, including clean installation and AUTH/Go interoperability; PR #27 is merged. Foundation evidence remains in [Stage 0](stage-0.md).
- Local `pnpm check` passed before this final checkpoint; final verification results are recorded below. This checks format, Oxlint/shadcn lint, contract generation, types, isolated tests and builds. Database-dependent tests are exercised separately rather than counting skipped unit-run integrations as coverage.
- `pnpm test:integration` passed against real PostgreSQL and LiveKit, including Go race checks. Tests cover concurrent setup/invite redemption, message deduplication/conflict/history, origin/body boundaries, guest administration denial, one-use WebSocket tickets, banned WebSocket disconnect, AUTH logout/session invalidation, and media grant replay.
- The LiveKit test establishes a real signaling connection, bans/removes the participant, observes disconnect and denies replay through the public Go gate. It also demonstrates that the same token can still connect directly to private upstream LiveKit: keeping signaling private is an essential security boundary. This is not an audio-quality test.
- All application container images built. A separate loopback-only Compose installation passed fresh setup, owner login, two guest identities, invitation replay denial, shared persisted history, concurrent send deduplication, guest administration denial, ban enforcement, revoked-session JWT denial and private AUTH ingress denial. Guest identity and history survived restarting PostgreSQL, AUTH and Go.
- Browser inspection exercised owner login, message send/history after restart and connection status. LiveKit joined the voice room in the browser. Microphone capture and two-person speech were not tested.
- Electron gateway tests passed for origin/TLS restrictions, gateway authentication, renderer cookie isolation, independent server cookie jars and persisted restore. An unsigned macOS arm64 development bundle was built using Electron Packager. Native application inspection timed out; a successful build does not prove native startup, microphone permissions or OS credential persistence.

## Remaining acceptance gates

1. Verify public trusted HTTPS, advertised media address, firewall/UDP reachability and TURN fallback. TURN configuration is not yet supplied. The smoke override intentionally uses loopback HTTP and cannot prove these properties.
2. Complete a fresh-install scenario with two real clients exchanging text and speaking with real microphones. Exercise mute/deafen, denied permissions, network interruption and reconnect without duplicate voice sessions.
3. Test the packaged Electron client on Windows and macOS, including OS encryption, server-origin changes, login/session persistence and microphone permissions. Apple signing/notarization is not configured; Windows signing is unavailable.
4. Add regression evidence for stale voice-leave versus replacement-session races and active registered-user voice revocation. Existing integration tests do not establish every client concurrency path.
5. Complete code review and record the required local checks for this PR. Further rate limits, recovery, diagnostics, operational readiness and load gates remain Stage 3 work, not delivered production guarantees.

Open admission controls, channel/category management, moderator provisioning, message edit/delete/retention, full device controls and saved-server management remain Stage 2. The local client is not yet the complete first private release.

## Tooling and reproducibility notes

TypeScript 7 is the repository default. Astro uses TypeScript 6 locally; `openapi-typescript` 7.13.0 uses a package-local TypeScript 5.9.3 because its compiler API is incompatible with TypeScript 7. pnpm remains the sole package manager and Bun executes AUTH. The first React Doctor scan reported 85/100; component decomposition and accessibility/formatter changes follow that report.

Local logs, generated packages and test credentials live under ignored `.tmp/`; they are not release artifacts or committed evidence containing secrets. The container smoke script requires a fresh disposable installation for its setup flow; `--verify-persistence` reuses only that script's local test state. Do not point integration tests at production.

## Final local checkpoint verification

After the final component/lifecycle refactor, `pnpm check` passed again on 2026-09-29. A full React Doctor scan covered 12 files and reported **100/100, no issues**. Final Go/AUTH integration and race tests passed after the session-specific leave implementation. The bounded container startup wait supports repeatable local container checks.

## Rebase onto merged foundation

PR #27 was squash-merged as `1729517` on 2026-09-29. This branch was rebased onto that main revision, retaining the nonblocking JWKS refresh and its race-tested regression cases. The Stage 1 Electron gateway supersedes the foundation preview at runtime; both gateway and foundation preview transport tests remain in the desktop test command. `pnpm check` passed after resolving the desktop/documentation conflicts. This does not change the outstanding real-device and deployment acceptance gates above.

## Update after removal of hosted workflows

Rebased onto main `e73a1dc` on 2026-09-29. The modify/delete conflict was resolved by retaining the deletion of `.github/workflows/ci.yml`. No GitHub Actions workflow is included in this PR. Documentation now requires local checks. This update changes documentation and removes automation only; application source is unchanged from the preceding rebased checkpoint. Formatting and Git whitespace checks were repeated; application tests were not rerun for this documentation-only update.
