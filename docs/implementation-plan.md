# Implementation plan

**Stage 0 is complete. Stage 1 acceptance remains open. Stage 2 is in progress on its own branch.** The foundation and conversation changes landed in PRs #27 and #28. Public media and real-device acceptance still apply to Stage 1. The first private desktop release will use Rust and GPUI on Windows and Linux and Electron on macOS. See the [Stage 1 evidence](evidence/stage-1.md#current-status) and [Stage 2 plan](stage-2-plan.md).

Stages use completion gates rather than dates. Stage 2 feature work may proceed on its own branch while Stage 1 waits for the acceptance run. Stage 1 acceptance remains separate. Keep changes reviewable.

## Stage 0 — Repository and compatibility foundation

**Goal:** establish a reproducible workspace and resolve integration risks before building the product.

Deliverables:

- Perform the separately scheduled [repository history reset](operations.md#repository-history-reset), retaining the GitHub repository and the approved documentation.
- Create the monorepo skeleton from [Development](development.md), configure pnpm workspaces with one JS/TS lockfile, retain Bun for AUTH execution, and add Turborepo orchestration plus standard Vite for the React client. Follow the selected configuration and verification gates in [Approved toolchain](toolchain.md).
- Establish Oxlint, Oxfmt, `@shadcn/lint`, type checks, EN/PL translation structure, and local verification commands.
- Verify deterministic pnpm installation, explicit Bun execution, task dependency selection, cache invalidation/restoration, and the chosen Go adapter before enabling incremental local checks.
- Pin the Elysia 2 Beta/Bun/Better Auth integration and demonstrate login plus JWT/JWKS verification from Go.
- Define the initial API/event contracts and role/identity boundaries.
- Validate Compose service topology, PostgreSQL isolation, LiveKit prerequisites, certificates, and public media connectivity.
- Record the exact supported dependency versions and investigation results; choose the first test hardware and OS/browser matrix.

**Completion gate:** a clean checkout installs and runs the configured checks; Go verifies a valid AUTH token and rejects invalid issuer/audience/expiry; all compatibility investigations have an executable test plan and identified owners (the solo developer). No placeholder production secrets are shipped.

Suggested branches: `chore/bootstrap-workspace`, `feat/verify-auth-integration`, `chore/add-quality-checks`.

## Stage 1 — First complete conversation

**Goal:** prove the entire system with minimal usable UI.

Deliverables:

- Compose startup, persistent volumes, HTTPS ingress, and host-authorized one-time owner setup.
- Owner login and a minimal community/channel configuration.
- Guest nickname entry, persistent identity, and invitation-only admission with a minimal owner invitation flow.
- Two admitted guests exchange persisted text messages in one channel and join one LiveKit voice channel.
- Minimal microphone mute/deafen and connection/error indicators, in EN and PL.
- A development Electron shell using the shared React client, with a tested credentials/origin boundary. Use it as the desktop reference for this stage.
- Basic server-side authorization, a working forced disconnect, and a media-token replay test.
- Reconnection that reconciles text history and makes voice state explicit.
- Refresh npm and Go dependencies and pinned images, use fresh PostgreSQL 19 volumes, and adopt `bun fmt` for repository formatting. [Keep Oxlint for linting](evidence/dependency-refresh-2026-11-21.md#bun-tooling-follow-up).

**Completion gate:** from a clean installation, the owner configures the server and two distinct clients join, exchange text, and speak. A guest cannot call administrative APIs. A banned/removed participant cannot continue publishing or immediately regain access using a cached grant. A brief network interruption can be recovered without duplicate messages or duplicate voice sessions. Record evidence and limitations.

Suggested branches: `feat/implement-owner-setup`, `feat/implement-guest-admission`, `feat/implement-basic-chat`, `feat/implement-voice-admission`.

## Stage 2 — Complete the agreed community features

**Goal:** implement the product behavior in [Product](product.md).

Deliverables:

- Categories and channel management; open/invitation-only mode; expiring, usage-limited, revocable invitations.
- Registered moderator provisioning, fixed roles, kick/ban/IP-block options, enforced mute, and message moderation.
- Own-message edit/delete, history pagination, retention, retry deduplication, and minimal moderation audit records.
- Device controls, per-participant volume, speaking indicators, foreground push-to-talk, and robust room transitions.
- A small Rust/GPUI prototype on Windows and Linux to validate the build, native session handling, and LiveKit through the Go signaling endpoint, including basic two-way audio. Record dependency choices, tested Linux distributions and desktop sessions, and platform limitations before building the full client.
- Complete responsive layouts, keyboard navigation, and EN/PL copy including error/recovery states.

**Completion gate:** the community feature acceptance scenarios pass, including concurrent invite redemption, role changes during active connections, reconnect after moderation, and retention. Document the limits of anonymous bans and lost guest credentials in the UI. Record the GPUI prototype results and resolve any blockers before the full desktop implementation.

Target branch: `feat/stage-2-community`. See the [work sequence](stage-2-plan.md#change-sequence). Admission controls, the channel catalog, moderation, and message lifecycle have local verification reports. Voice controls and the GPUI prototype remain to be implemented.

## Stage 3 — Operational reliability and capacity

**Goal:** make a deployed instance recoverable and measurable.

Deliverables:

- Installation instructions, configuration reference, resource/port inventory, health checks, bounded local logs, and diagnostics export.
- Host-side owner recovery, signing-key rotation, session/account revocation, and rate limits.
- Coordinated backup and restore for both databases, configuration, secrets, and identity/signing material.
- Manual upgrade procedure with a maintenance window and migration/recovery checks.
- Automated acceptance load with the agreed workload, plus real voice sessions and resource measurement.
- Failure testing for AUTH, Go, media service, database, and client-network interruptions.

**Completion gate:** all mandatory recovery, authorization, and load gates in [Validation](validation.md) pass on documented hardware. A backup restores onto a clean host. A failed upgrade has a demonstrated recovery procedure. Remaining bottlenecks and unsupported network/platform cases are documented.

Suggested branches: `feat/implement-backup-restore`, `feat/implement-diagnostics`, `test/verify-capacity-and-recovery`.

## Stage 4 — Desktop and first private release

**Goal:** let friends install and use the application with accurate documentation.

Deliverables:

- A native Rust/GPUI client on Windows and Linux and an Electron client on macOS. Preserve one-to-one parity with the existing Electron interface in GPUI, including layout, colors, typography, component states, and keyboard and responsive behavior. Verify the agreed community features, EN/PL UI, saved servers with independent identities, and one active voice conversation on each client.
- Release packages for Windows, supported Linux distributions, and macOS, with manual update instructions and clean installation tests. For Windows and Linux, decide how to handle Electron development profiles. Verify safe credential transfer if supported, or document re-login and the effect of rejoining as a guest on identity and message ownership.
- Use available Apple signing and notarization for the macOS Electron package when credentials are configured. Record Windows signing status and the Linux package format and integrity verification.
- Desktop and mobile Web verification on the agreed browser/device matrix.
- Test global push-to-talk on each target platform. Foreground push-to-talk remains the baseline.
- Astro landing in EN/PL with working language selection, matching installation documentation, and real download links when artifacts exist.
- Private release notes, known limits, compatibility information, and reproducible image/package version mapping.

**Completion gate:** the full first-release checklist passes, including desktop protocol, identity, media, and package checks on Windows, Linux, and macOS. Friends can follow the instructions without developer-only commands. The UI and landing describe only verified distribution and voice capabilities. Release publishing is a distinct action from local artifact preparation.

Suggested branches: `feat/implement-gpui-desktop`, `feat/package-desktop-client`, `feat/implement-bilingual-landing`, `docs/document-private-release`.

## Stage 5 — Stabilization

Collect deliberately shared feedback from the first group. Prioritize data loss, joining failures, audio defects, resource growth, and upgrade/restore failures. Maintain no automatic external telemetry.

**Completion gate:** the agreed core flows are used successfully by the group; release-blocking defects are resolved and repeatable regression checks cover fixes. Explicitly review readiness before expanding platform count.

## Stage 6 — Native mobile clients

Build Swift clients for iOS/iPadOS and Kotlin/Jetpack Compose clients for Android phones/tablets against the same server contract. Reuse product semantics rather than adding new server features concurrently.

At stage entry, specify credential transfer/recovery, native auth redirects, background audio, interruption handling, Bluetooth routing, and any push-notification infrastructure. Preserve installation independence when evaluating optional external push services.

**Completion gate:** shared API conformance and core product scenarios pass, together with real-device background-call and OS interruption tests. Platform-specific service dependencies and limits are documented.

## Stage 7 — Rust terminal client

Develop a Rust/Ratatui client. Define its text, moderation, and voice-control scope at stage entry, including the media/audio implementation and credential storage.

**Completion gate:** the declared terminal feature set passes the same protocol and authorization contracts as other clients.

## Stage 8 — Native macOS client

Develop the dedicated Swift macOS application using the established protocol and product behavior. Decide the transition from Electron, local identity transfer, and supported macOS versions at stage entry.

**Completion gate:** verify core scenarios, media behavior, package installation, and the documented transition before replacing Electron on macOS.

## Later feature backlog

Attachments, direct messages, screen sharing, camera, search, reactions, custom roles, account linking, optional Google login, and wider hosting topologies remain candidates. Their order is determined from usage after stabilization and the native-mobile priority. They are not hidden requirements of Stages 0–5.
