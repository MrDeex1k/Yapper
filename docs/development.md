# Development workflow

## Language and repository structure

Use English for source identifiers, comments, documentation, branches, and commits. Product copy is localized in English and Polish.

Current monorepo layout; exact packages are listed by pnpm:

```text
apps/web/             React application and administration UI
apps/desktop/         Stage 1 Electron development shell and smoke tooling
apps/desktop-gpui/    Rust/GPUI desktop app for Windows and Linux
apps/macos/           Native Swift and SwiftUI macOS client
apps/mobile/          Android and iOS clients, shared Kotlin module and Apple Xcode project
apps/auth/            Bun, Elysia 2 RC, Better Auth
apps/landing/         Astro project website
packages/ui/          Shared design-system components
packages/i18n/        Shared UI translations and locale helpers
packages/api/         Generated TS contracts and client transport
crates/voice-policy/  Shared Rust microphone publication rule
server/               Go application module
deploy/               Compose, ingress, and deployment configuration
scripts/              Development and operational commands
docs/                 Specifications, plans, and decision records
```

Use pnpm workspaces and one committed `pnpm-lock.yaml` for JS/TS dependency installation. Bun runs AUTH, Turborepo orchestrates repository tasks, and Vite builds the React client. Cargo builds GPUI and its voice policy. Gradle builds the Android app and shared Kotlin module. Xcode builds the Apple clients. See the [toolchain](toolchain.md#native-client-builds) and the client README files for local commands.

Repository scripts and Astro configuration use TypeScript. Node 26 executes `.ts` scripts through native type stripping; `pnpm typecheck:scripts` checks them with strict types and `erasableSyntaxOnly`, and is included in `pnpm typecheck`/`pnpm check`. Type stripping does not perform type checking. Preload and native Electron smoke sources use `.cts` and are compiled to CommonJS for Electron. The smoke harness is emitted into ignored `.test-tools/`, outside the application's package allowlist; the preload is emitted into `dist/preload.cjs`. Both are checked by the desktop type-check command. Do not commit generated JavaScript.

## Required skills and documentation

These workflow requirements were requested by the owner on 2026-09-29. Resolve skills through the current agent skill catalog rather than hard-coding one machine's plugin-cache paths.

- **Interfaces — `frontend-skill`:** apply it before creating or substantially changing an application interface or the Astro landing. Before implementation, state a visual thesis, content/layout plan, and interaction thesis. Use the relevant guidance for application interfaces or the landing page. Preserve EN/PL copy, keyboard accessibility, and reduced-motion preferences across clients. Preserve Base UI components in React.
- **Current library documentation — Context7:** resolve the library ID, then query the relevant API or integration for the project's pinned version. Verify version coverage, particularly for Elysia 2 RC. If coverage is missing or outdated, consult official documentation, release notes, or source and record the gap. Keep secrets and private project data out of external documentation queries.
- **Go idioms — `modern-go-guidelines:use-modern-go`:** before writing, modifying, fixing, or refactoring Go code, run the skill wrapper's `list` command for the target file or established Go version. Read its complete, unfiltered output. Use `explain` for specific guideline IDs when needed, including before skipping an apparently relevant guideline. Follow the version-specific guidance; this check does not replace compilation and tests.
- **Go engineering — `engineering-skills-for-go`:** read the skill matching the actual work before applying its workflow. Use the routing table below rather than loading all skills for every Go edit.

| Work                                                                          | Skill                                                 |
| ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| Local types, errors, interfaces, generics, and data                           | `go-language-engineering`                             |
| Packages, modules, exported APIs, and compatibility                           | `go-project-and-api-design`                           |
| HTTP, WebSocket integration boundaries, request lifecycle, and shutdown       | `go-service-boundaries` (within its documented scope) |
| Authentication/authorization, input handling, secrets, and exploit prevention | `go-security-hardening`                               |
| Test design, race checks, fuzzing, and deterministic verification             | `go-testing-and-verification`                         |
| Health, telemetry, process lifecycle, and releases                            | `go-production-operations`                            |
| Measured CPU, memory, latency, and contention issues                          | `go-performance-and-diagnostics`                      |
| Reviewing a Go change                                                         | `review-go-engineering-change`                        |

Read each skill's actual instructions when invoked. If a required capability is unavailable, report the concrete limitation and continue independent work; do not claim that the skill, documentation lookup, or CLI check was performed.

## Branches and squash commits

Branch names must not contain `codex` in any letter case. Use a short English description derived from the intended squash-commit subject:

| Squash commit title                  | Branch                              |
| ------------------------------------ | ----------------------------------- |
| `feat: implement auth`               | `feat/implement-auth`               |
| `feat: implement stage 1`            | `feat/implement-stage1`             |
| `fix: restore voice after reconnect` | `fix/restore-voice-after-reconnect` |
| `docs: define implementation plan`   | `docs/define-implementation-plan`   |

Prefer one coherent change per branch. `feat/implement-stage1` is permitted, but large stages should normally be split into smaller reviewable branches. Supported prefixes include `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`.

Use squash & merge for pull requests. The final squash title describes the resulting change and follows the type/subject convention above. Update branch/PR wording when scope changes; mechanical word-for-word matching is unnecessary. Keep the main branch linear; merge commits are not used.

When repository configuration is implemented, enable squash merging, disable merge-commit merging and rebase merging for PRs, and require recorded local verification before merging. The one-time new-history initialization is separate from normal PR work.

## JavaScript and TypeScript quality

- Run `pnpm lint` for AUTH, Web, Electron, shared packages, and supported landing source. It runs Oxlint with warnings treated as errors. See the [Stage 1 tooling evidence](evidence/dependency-refresh-2026-11-21.md#bun-tooling-follow-up) for the Bun lint evaluation.
- Run `pnpm format` to format files and `pnpm format:check` to check them. Both use `bun fmt` with the repository's existing formatting style. Prettier with the Astro plugin handles `.astro` files.
- `@shadcn/lint` enforces UI design-system rules through Oxlint. It applies to UI consumers, not unrelated AUTH backend code.
- Begin with centralized tokens, static classes, and component variants. Enable rules such as `no-restyle`, `no-raw-colors`, `no-arbitrary-values`, and `require-static-classes` after verifying compatible configuration. Scope exceptions to design-system internals where necessary.
- Use shadcn/ui's Base UI variant consistently. Keep application-specific variants in the shared UI package.
- Type checking is a separate check; lint and formatting do not replace it.
- Enforce EN/PL translation-key parity and test language switching. Keep user-facing API errors represented by stable codes translated by clients.

The [shadcn lint documentation](https://github.com/shadcn-ui/lint) inspected during planning requires Oxlint 1.80 or newer and describes its JS plugin API as alpha. Pin and test compatible versions rather than relying on floating upgrades.

## Local verification

GitHub Actions workflows are not permitted in this repository. Run checks locally and record their results in the PR; do not add files under `.github/workflows/`.

Run `pnpm check` for formatting, lint, API drift, type checking, isolated tests, and builds in the pnpm workspace. Run Cargo, Gradle, and Xcode checks separately. Run `pnpm test:integration` separately against the disposable development database; it is uncached. Root build/test/typecheck wrappers include actual toolchain/platform versions in Turbo cache identity. Use those wrappers for artifact-producing checks.

Local JS/TS verification checks formatting, lint, types, translation parity, and relevant unit/integration tests. Local Go verification uses formatting, static analysis, tests, and race testing for concurrency-sensitive code. Test contracts between AUTH, Go, and clients against real services where mocks would hide compatibility failures.

Use browser end-to-end tests for setup, joining, chat, roles, and language switching. Media verification includes real devices and actual microphone/network behavior; fake media and browser automation alone are insufficient.

Build container images and validate Compose configuration. For desktop packaging work, build GPUI for Windows and Linux. Verify clean installation using the [desktop acceptance criteria](validation.md#desktop-acceptance). Publish artifacts only through an explicitly authorized release procedure. Pin versions and image references.

For each PR, state the resulting behavior, relevant tests and evidence, migration impact, and any remaining platform limits. A skipped or unavailable check is reported as unverified.

## Go and Rust verification tools

Run `./scripts/check-go-analysis.sh` from the repository root with the pinned Go toolchain. It runs Staticcheck and a focused set of go-critic checks for defects such as ignored cleanup, duplicate expressions and incorrect arguments. The linters use versioned `go run` invocations so their dependency graph stays separate from the server's. The HTTP and media packages check for leftover goroutines after their test suites. Run `cd server && go test -race ./...` to exercise those checks.

Install the Rust analysis tools with Rustup and the repository's stable compiler:

```sh
rustup toolchain install 1.100.0 --profile minimal
rustup toolchain install nightly-2026-11-23 --profile minimal --component miri,rust-src
cargo +1.100.0 install --locked cargo-geiger@0.14.0 cargo-mutants@27.1.0
cargo +1.100.0 install --locked kani-verifier@0.68.0
cargo +1.100.0 kani setup
```

Kani's prebuilt setup covers macOS on Apple Silicon and Intel, and x86-64 Linux. Run it from a supported host. Windows developers can use an x86-64 Linux environment with the repository checked out there. The commands below use a POSIX shell.

| Command                                                   | Scope                                                                                                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./scripts/check-rust.sh geiger`                          | Inventory unsafe constructs in the production voice policy.                                                                                                                           |
| `./scripts/check-rust.sh geiger x86_64-unknown-linux-gnu` | Inventory the GPUI crate and its target's dependencies from a matching build environment. The [GPUI setup](../apps/desktop-gpui/README.md) applies. Treat the report as review input. |
| `./scripts/check-rust.sh miri`                            | Interpret the policy's unit test with a pinned nightly and check the exercised paths for undefined behavior.                                                                          |
| `./scripts/check-rust.sh mutants`                         | Check whether the policy test catches changes to production code. Reports are under `.tmp/voice-policy/mutants.out/`.                                                                 |
| `./scripts/check-rust.sh kani`                            | Check all 16 combinations of intent, connection, publication permission, and deafen state against the policy's truth table.                                                           |

The policy checks run without LiveKit, a display server, or audio devices. For a GPUI audit on Windows, use `x86_64-pc-windows-msvc` with the native prerequisites. Geiger uses a separate Cargo build directory under `.tmp/geiger/` because its scan cleans cached build outputs. See the [Stage 7.5 verification record](evidence/stage-7-5-verification.md) for results and coverage limits.

## Web end-to-end tests

`pnpm test:e2e` uses [Flashwright](https://github.com/xcodebeast/flashwright) pinned through the `@playwright/test` npm alias. The `playwright` CLI name comes from the alias. Tests use separate browser contexts, wait for animated controls, and keep the usual assertion timeout for live events. The runner disables the background warm session.

Run from a development checkout with a current disposable `.env`, or use `pnpm setup:dev` to generate one in a fresh checkout. The browser fixture uses its own Compose project, PostgreSQL volumes, and loopback ingress at port 18090. LiveKit uses loopback ports 7881 and 7882.

```sh
pnpm install --frozen-lockfile
pnpm setup:dev
pnpm exec playwright install chromium firefox webkit
export YAPPER_DOMAIN=localhost YAPPER_PUBLIC_IP=127.0.0.1
export YAPPER_AUTH_IMAGE=yapper-browser-auth:local
export YAPPER_SERVER_IMAGE=yapper-browser-server:local
export YAPPER_INGRESS_IMAGE=yapper-browser-ingress:local
docker compose -p yapper-browser-test -f compose.yaml -f test/e2e/compose.yaml up -d --build --wait
pnpm test:e2e
docker compose -p yapper-browser-test -f compose.yaml -f test/e2e/compose.yaml down --volumes
```

The suite initializes the disposable installation using its setup token. Use `pnpm test:e2e --project=chromium` to run only Chromium. The suite covers invitations, channel management and form recovery, live chat and reload, and a muted voice join. Real-device audio, mobile browsers, and the other clients have separate acceptance checks. Keep the original tools named in historical evidence.

If the bundled Firefox on macOS 27 fails with `Could not find profile folder`, run its project on Linux. This is a [known issue with the bundled browser](https://github.com/microsoft/playwright/issues/42768).

With OrbStack running the fixture, run the Firefox project from the matching Linux browser image:

```sh
docker --context orbstack run --rm --network host -v "$PWD:/workspace" -w /workspace \
  mcr.microsoft.com/playwright:v1.64.1-noble@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f \
  node --env-file=.env test/e2e/run.ts --project=firefox
```

The Firefox test profile enables loopback ICE and uses IP candidates because the local LiveKit fixture runs across a container network without multicast DNS.

## Stage 1 Electron smoke test

To reproduce the Stage 1 Electron development checks, run `pnpm build`, install the pinned Electron runtime, then run `pnpm test:desktop` on a desktop host with OS credential storage available. Supply `DESKTOP_TEST_SERVER` (an already configured disposable server origin) and `DESKTOP_TEST_INVITATION` (a fresh single-use invitation) through the environment. A private ignored environment file can be loaded with `node --env-file=.tmp/desktop-test.env scripts/test-desktop.ts`.

The command starts the actual Electron entry point twice with an isolated temporary profile. The harness uses an Electron-version-specific application name so unsigned development runtimes do not share the generic Electron Keychain entry. It checks sandbox/context isolation, lack of renderer Node access, guest admission, cookie isolation, encrypted on-disk state, selected-server/identity restoration across process restart, and the rendered conversation after reload. Each process has a 30-second hard deadline. Temporary local credentials/profile files are removed on completion or failure; the admitted test participant remains on the disposable server.

This explicit local test is not a cached Turbo task and is not part of `pnpm check`. It does not capture a microphone or prove packaging, signing, public HTTPS, real voice or Windows behavior when run on macOS. The test harness is outside the desktop package's `files` allowlist.

## TURN deployment test

Build the local ingress image first (`docker compose build ingress` with the required base environment), then run `pnpm test:turn` with Docker, Go and OpenSSL available. Set `DOCKER_CONTEXT=orbstack` when using OrbStack. The command compiles an isolated Linux test binary for the Docker engine's architecture and starts disposable LiveKit, HAProxy and Caddy containers derived from the real `compose.turn.yaml` overlay. It uses no production volumes or public host ports and removes its containers, networks, keys and fixtures when it finishes. The test subnet is `172.30.245.0/29`; an overlap causes the test to fail instead of modifying an existing network.

The test checks HTTPS/TURN hostname routing, trusted versus untrusted TLS, TURN credentials from actual LiveKit signaling, rejected incorrect credentials, forwarded client address, relay address/port range, a bidirectional UDP payload through TURN/TLS and denial of a link-local metadata peer. Only the isolated fixture permits its private subnet as a TURN peer. It does not prove public CA issuance, host firewall/NAT mappings, browser ICE selection or real speech. This uncached Docker test is separate from `pnpm check` and normal database integrations.
