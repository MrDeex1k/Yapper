# Stage 0 foundation evidence

Date: 2026-09-29. Branch: `chore/bootstrap-workspace`. Status: local foundation checks passed; PR/CI review pending. This is not a release or a completed conversation.

## Environment and pins

Local machine: macOS 27.0.1 (26A434), arm64. Docker runs through OrbStack, Engine 29.4.0. Dedicated Compose project: `yapper-rebuild`, PostgreSQL bound to loopback port 55439. Existing unrelated containers are untouched.

Node 24.20.0, pnpm 12.6.0, Bun 1.4.2, Go 1.27.1, Turbo 2.11.4, Vite 8.3.1, React 19.3.0, Elysia 2.0.0-beta.19, Better Auth 1.7.6, Oxlint 1.85.0, Oxfmt 0.70.0, shadcn lint 0.2.0, Astro 7.3.5, Electron 44.4.5. Exact transitive versions are in the pnpm lockfile and Go module files.

Astro's checker currently supports TypeScript 5/6, so the landing pins TypeScript 6.0.3; other TS packages use 7.0.2. `pnpm peers check` reports no issues. Oxfmt 0.70.0 ignores `.astro`, verified with an explicit file glob; Prettier 3.9.9 with prettier-plugin-astro 1.1.0 handles only those files. Oxc handles other supported files. pnpm permits only esbuild's required install script. Electron's official runtime installer is an explicit separate development command.

## Executed checks

- `pnpm check`: formatting (including Astro), Oxlint with shadcn rules, type checking, Bun tests, Go vet/race tests, AUTH/Web/Astro/Go/Electron-main builds passed locally.
- AUTH unit tests: required configuration, origin rules, secret length; translation tests: EN/PL key parity and nonempty copy.
- Go identity tests: valid Ed25519 JWT, wrong issuer/audience/expiry, absent required claims/key ID, algorithm confusion, untrusted token URL, bounded unknown-key refresh and JWKS redirect rejection.
- `pnpm test:integration`: real PostgreSQL migrations; closed public signup; username/password login through Elysia; actual Better Auth JWT and JWKS accepted by Go; logout prevents new token issuance. No passwords or tokens written into evidence.
- `go mod verify`: passed; all modules verified.
- Browser: connection button reached the Go health endpoint; PL→EN language switch persisted after reload. Desktop appearance inspected. This does not prove mobile compatibility or microphone behavior.
- React Doctor full scan: 100/100, no findings. Changed-only scan initially skipped untracked source, so the full scan was required.
- Turbo: repeated build hit all five artifact-producing tasks; deleting their generated outputs and rebuilding restored all five from cache. Dry-run hashes changed for Web/landing/Electron after shared i18n changes, Go after Go source changes, and every task after shared TS configuration changes. Original hashes returned after restoring source. Root task wrapper includes actual platform, architecture, Node, Bun and Go versions in cache identity. Remote cache remains disabled.
- Electron main process compiled and official runtime launched without terminal errors. Native UI tooling selected an unrelated installed Electron; therefore visual startup of the Yapper Electron window remains unverified. No Windows/package-install claim.

## Repository reset

New root: `5cbfb87f91c894fdb8ba616b940b50f1e6b9eb92`. Replaced old main `a25031fd637f51fb70ded99fc03c877c38c92666` and deleted 23 obsolete branch refs in one atomic push guarded by exact old SHAs. A fresh clone reported one commit and the new root with no parent. No tags or releases existed. Old PRs are no longer open. Removed 36 old Actions runs and their artifacts. Enabled squash-only PR merging. The GitHub repository was retained.

GitHub Packages inventory returned 403 (missing `read:packages`); package cleanup is unverified. Old commit objects may remain in GitHub retention, PR refs, forks or external clones. No physical erasure claim is made.

## Compatibility investigations and owners

All investigations are owned by the solo maintainer. The initial automated test host is this macOS arm64 machine plus Linux CI; Windows/macOS release runners and physical iPhone/iPad/Android devices must be recorded before platform gates can pass.

| Investigation                   | Evidence or next executable scenario                                                                                                                                           | Gate                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| AUTH beta compatibility         | Real login/JWKS test passes. Context7 Elysia examples mostly target v1; installed beta source and compiler/runtime checked instead.                                            | Foundation                    |
| Key rotation and AUTH outage    | Publish old+new keys, verify both, retire old after overlap; stop AUTH and test cached known/unknown keys. Add deterministic integration cases before account operations.      | Stage 1/3                     |
| Immediate registered revocation | Existing short-lived JWT remains valid after logout in the foundation. Add current-session validation, then revoke while API/WebSocket is active and assert denial/disconnect. | Stage 1                       |
| Guest/Electron credentials      | Use distinct Web clients and Electron origins; close/reopen, change server, clear local preferences, and prove credentials remain isolated. No secret renderer storage.        | Stage 1                       |
| LiveKit replay                  | Run self-hosted LiveKit, save a grant, remove/ban identity, reconnect using the saved grant and require denial before media publication.                                       | Stage 1 blocker until passed  |
| Public media topology           | On a Linux host with a trusted domain, test HTTPS/WSS, UDP, then block UDP and test TURN/TLS. Verify advertised public IP and certificate chain.                               | Stage 1 and real-network gate |
| Mobile foreground voice         | On recorded iOS/iPadOS Safari and Android Chrome devices: permission, mute/deafen, interruption/reconnect, route change and foreground call.                                   | Stage 4                       |
| Distribution                    | Build Windows/macOS packages on matching runners and install on clean devices; signing status explicit.                                                                        | Stage 4                       |

Self-hosted LiveKit does not automatically revoke issued tokens when removing participants. Short expiry alone does not meet the approved replay gate. Proposed implementation: expose signaling only through a Go admission boundary that checks current media-session membership on every initial/reconnect WebSocket handshake; keep LiveKit signaling private; synchronously remove active sessions on moderation. Pin and test the actual server before claiming this closes the replay window. LiveKit-generated refreshed tokens and racing admissions are explicit test cases. Reference: [LiveKit token lifecycle](https://docs.livekit.io/frontends/authentication/tokens).

A single-node LiveKit deployment can begin without Redis; multi-node deployment is deferred. Validate the pinned container configuration and actual ports during Stage 1. Public media reachability and certificates cannot be inferred from the working local PostgreSQL setup.

## Remaining acceptance work

Fresh staged-source export into a separate temporary directory passed `pnpm install --frozen-lockfile` and `pnpm check` without local dependencies or secrets. The first attempt inside ignored `.tmp/` was invalid because Oxfmt inherited the parent ignore rule; the independent-directory rerun passed. CI review remains pending. Production Compose/HTTPS, real media, setup, admissions and conversation UI are not implemented in this foundation. Astro and Electron are compatibility scaffolds. shadcn lint is active; the current single button uses Base UI directly, with shared shadcn components to follow in Stage 1. No phase/version label substitutes for these gates.

## CodeRabbit review corrections — 2026-09-29

PR #27's two functional findings were reproduced from the bootstrap source and addressed on `chore/bootstrap-workspace`. Docstring coverage feedback was intentionally excluded at the owner's request.

- Electron no longer loads the foundation renderer from `file://`. A loopback HTTP server serves bundled files and forwards only the public health probe to the configured Go origin. Browser security remains enabled and the Web Vite proxy is unchanged. The transport rejects foreign Host/Origin values, redirects, non-GET requests and access to other API routes; it forwards no cookies or authorization headers.
- JWKS HTTP I/O and parsing happen outside the cache mutex. Concurrent refresh callers share a completion channel and can cancel their wait; valid cached keys remain usable during a slow refresh. Failed parsing preserves the previous cache and expiry. Refresh attempts retain the five-second limit.
- `pnpm check` passed after the corrections, including Oxlint/Oxfmt, type checks, desktop transport regression tests, Go race tests, and builds. Deterministic `testing/synctest` cases cover successful rotation and malformed refresh while known-key lookups and concurrent waiters run. Transport tests exercise the same-origin static/health routes over real local HTTP.
- Context7 Electron documentation confirmed the awaited HTTP listener plus `BrowserWindow.loadURL` pattern and existing sandbox settings. Native Windows/macOS GUI behavior was not revalidated by these tests; the tests establish the transport behavior, not platform acceptance.

The optional real AUTH/PostgreSQL integration rerun was attempted but could not start: PostgreSQL at loopback port 55439 refused the connection and the OrbStack Docker socket was unavailable. No new successful database integration run is claimed for this review commit; the passing isolated JWT/JWKS and concurrency tests are separate evidence.
