# Implementation plan

**Stages 0–4 are closed and Stage 5 is deferred. Stages 6 and 7 have working native clients with acceptance checks open. Stage 7.5 tooling is in place. Stage 8 is planned.** See [Validation](validation.md) for recorded results and outstanding checks.

Stages use completion gates rather than dates. Stage 6 can proceed while Stage 5 is deferred. Retain stage numbers so existing records remain traceable.

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
- A development Electron shell using the shared React client, with a tested credentials/origin boundary. This shell was the desktop reference for Stage 1.
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
- A small Rust/GPUI prototype on Windows and Linux. Verify native session handling and basic two-way LiveKit audio through the Go signaling endpoint on Windows GPUI and macOS Web. Review the Linux rendering under X11 using Xvfb. Record dependency choices and platform limitations before building the full client.
- Complete responsive layouts, keyboard navigation, and EN/PL copy including error/recovery states.

The Web invitation panel uses TanStack Query for its owner-scoped list and refresh after invitation changes. The Web channel editor uses React Hook Form and Zod to guard unsaved changes when switching channels and show field-level validation. Go remains authoritative for validation and authorization.

**Completion gate:** the community feature acceptance scenarios pass, including concurrent invite redemption, role changes during active connections, reconnect after moderation, and retention. Document the limits of anonymous bans and lost guest credentials in the UI. Record the GPUI prototype results and resolve any blockers before the full desktop implementation.

Target branch: `feat/stage-2-community`. See the [work sequence](stage-2-plan.md#change-sequence) and the [acceptance record](evidence/stage-2-acceptance.md) for results and platform limits.

## Stage 3 — Operational reliability and capacity

**Goal:** make a deployed instance recoverable and measurable.

Deliverables:

- Installation instructions, configuration reference, resource/port inventory, health checks, bounded local logs, and diagnostics export.
- Host-side owner recovery, signing-key rotation, session/account revocation, and rate limits.
- Coordinated backup and restore for both databases, configuration, secrets, and identity/signing material.
- Manual upgrade procedure with a maintenance window and migration/recovery checks.
- Automated acceptance load with the agreed workload, plus real voice sessions and resource measurement.
- Failure testing for AUTH, Go, media service, database, and client-network interruptions.

Use TanStack Table when the participant directory or moderation audit needs independently sortable and filterable columns. Define server-side filtering and ordering across the full result set before wiring a paginated table to it.

**Completion gate:** all mandatory recovery, authorization, and load gates in [Validation](validation.md) pass on documented hardware. A backup restores onto a clean host. A failed upgrade has a demonstrated recovery procedure. Remaining bottlenecks and unsupported network/platform cases are documented.

Suggested branches: `feat/implement-backup-restore`, `feat/implement-diagnostics`, `test/verify-capacity-and-recovery`.

## Stage 4 — Desktop and first private release

**Goal:** let friends install and use the application with accurate documentation.

Deliverables:

- A native Rust/GPUI client on Windows and Linux. Preserve one-to-one parity with the Web interface carried forward from the Stage 1 desktop shell, including layout, colors, typography, component states, and keyboard and responsive behavior. Verify the agreed community features, EN/PL UI, saved servers with independent identities, and one active voice conversation on each client.
- Release packages for Windows and supported Linux distributions, with manual update instructions and clean installation tests. Document how users of Stage 1 development builds can rejoin or sign in again and how that affects guest identity and message ownership.
- Record Windows signing status and the Linux package format and integrity verification.
- Desktop and mobile Web verification on the agreed browser/device matrix.
- Test global push-to-talk on each target platform. Foreground push-to-talk remains the baseline.
- Astro landing in EN/PL with working language selection, matching installation documentation, and real download links when artifacts exist.
- Private release notes, known limits, compatibility information, and reproducible image/package version mapping.

Use TanStack Router in Web for shareable channel URLs and browser history. Verify direct links and reloads. Keep the voice session in a shared layout above channel routes.

The [Stage 4 naming audit](evidence/stage-4-naming.md) and its Web, Go, and GPUI fixes are complete. A GPUI regression test covers failed actions that finish after a text channel switch.

**Completion gate:** the full first-release checklist passes, including desktop protocol, identity, media, and package checks on Windows and Linux. Friends can follow the instructions without developer-only commands. The UI and landing describe only verified distribution and voice capabilities. Release publishing is a distinct action from local artifact preparation.

Suggested branches: `feat/implement-gpui-desktop`, `feat/package-desktop-client`, `feat/implement-bilingual-landing`, `docs/document-private-release`.

## Stage 5 — Stabilization

**Status: deferred.** Private-group feedback, release-blocking defect triage, and the Web runtime benchmark remain available when this stage resumes.

Collect deliberately shared feedback from the first group. Prioritize data loss, joining failures, audio defects, resource growth, and upgrade/restore failures. Maintain no automatic external telemetry.

The [Stage 2 TanStack Redact benchmark](evidence/stage-2-redact.md) measured a smaller Web bundle and a faster cold start. Repeat the comparison after measuring deferred loading of LiveKit. Verify physical-device voice behavior and compatibility across supported Web browsers before deciding whether to adopt the alternate runtime.

**Completion gate:** the agreed core flows are used successfully by the group; release-blocking defects are resolved and repeatable regression checks cover fixes. Explicitly review readiness before expanding platform count.

## Stage 6 — Native mobile clients

**Status: Android and iPhone/iPad clients are implemented, with physical-device and distribution acceptance pending.** The shared Kotlin Multiplatform module handles client logic and server API integration. Android uses Jetpack Compose and the Apple client uses SwiftUI. Windows at least 760 dp wide on Android or 760 points wide on iOS and iPadOS show the channel list next to chat. Narrower windows use a collapsible channel list.

Guest admission, chat, muted voice joins, and tablet layouts were exercised on Android emulators and Apple simulators. Physical two-way audio and lifecycle checks remain open. See the [mobile plan](stage-6-mobile-plan.md) and [verification record](evidence/stage-6-mobile.md).

**Completion gate:** shared API conformance and core product scenarios pass, together with real-device background-call and OS interruption tests. Platform-specific service dependencies and limits are documented.

## Stage 7 — Native macOS client

**Status: native client implemented, with physical audio, accessibility, and distribution acceptance pending.** The first target is macOS 26 or later on Apple Silicon. The desktop application uses SwiftUI, Foundation networking, Keychain and the LiveKit Swift SDK. Mobile keeps its Kotlin Multiplatform client. The Mac target shares Swift presentation and audio code with iOS. See the [Mac build and Web transition](../apps/macos/README.md) and [verification record](evidence/stage-7-macos.md).

**Completion gate:** verify core scenarios, media behavior, package installation, and the documented transition from Web.

## Stage 7.5 — Go and Rust verification

**Status: tooling implemented and baseline checks recorded.** The local Go checks use goleak, Staticcheck, and go-critic. The production microphone policy used by GPUI has results from cargo-geiger, Miri, cargo-mutants, and Kani. The [Flashwright suite](development.md#web-end-to-end-tests) passed in Chromium, Firefox, and WebKit on Linux arm64. Windows Rust verification remains open.

**Completion gate:** run the Go race suite and analysis, exercise each Rust tool on the production policy crate, and verify the Web scenarios in Chromium, Firefox, and WebKit. Record scope and results in the [Stage 7.5 verification record](evidence/stage-7-5-verification.md).

## Stage 8 — Rust terminal client

**Status: planned.** Build a Rust/Ratatui client for macOS, Linux, and Windows. Users can read and send plain-text messages in accessible text channels and join or leave voice channels for two-way audio. The terminal client does not offer message editing, message deletion, or moderation.

Start with a compatibility probe for credential storage, terminal lifecycle, and two-way audio on all three platforms. Then deliver text chat, voice, and private build verification. See the [Stage 8 plan](stage-8-terminal-plan.md) for the work sequence and exit checks.

**Completion gate:** the [terminal acceptance checks](validation.md#terminal-client-acceptance) pass on macOS, Linux, and Windows against the existing protocol and authorization contracts.

## Later feature backlog

Attachments, direct messages, screen sharing, camera, search, reactions, custom roles, account linking, optional Google login, and wider hosting topologies remain candidates. Order them using feedback when stabilization resumes.
