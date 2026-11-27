# Approved monorepo toolchain

Approved on 2026-09-29: **pnpm + Turborepo + standard Vite, with Bun as the AUTH runtime**. This is the implementation baseline. Vite+ is not part of the selected stack; the comparison below records why. Pinned tools and executed compatibility checks are recorded in [Stage 0 evidence](evidence/stage-0.md).

## Tool ownership

| Layer                 | Tool                                     | Responsibility                                             |
| --------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| JS/TS dependencies    | pnpm                                     | Workspace linking, installation, lockfile                  |
| Repository tasks      | Turborepo                                | Ordering, parallelism, filtering, task-result cache        |
| React client          | Vite                                     | Development server and production browser/renderer bundles |
| Landing               | Astro CLI                                | Astro development/build pipeline                           |
| AUTH execution        | Bun                                      | Elysia 2 RC and Better Auth runtime                        |
| Tooling execution     | Pinned supported Node.js                 | Frontend tooling and repository scripts                    |
| Electron desktop      | Electron                                 | Stage 1 development shell and historical smoke tests       |
| Rust desktop          | Rust, Cargo, GPUI                        | Native desktop builds and UI on Windows and Linux          |
| Mobile                | Kotlin Multiplatform, Gradle, Xcode      | Shared Kotlin logic and native Android and iOS/iPadOS UIs  |
| Swift desktop         | Swift, Xcode                             | Native macOS client                                        |
| Quality               | Oxlint, Bun fmt, TypeScript, shadcn lint | Separate lint, formatting, types, and UI policy            |
| Application server    | Go                                       | Compilation and dependencies for the application server    |
| Deployed services     | Docker Compose                           | Runtime lifecycle and networking                           |

Root scripts delegate repository scheduling to Turbo. AUTH scripts explicitly invoke Bun, for example `bun --watch src/index.ts` or `bun src/index.ts`. Browser JavaScript runs in the browser. Cargo builds the Windows and Linux desktop client. The retained Stage 1 shell uses the Electron runtime.

## Native client builds

The Windows and Linux desktop client pins Rust 1.100.0 and GPUI 0.2.2 with a committed Cargo lockfile. Run its [Cargo checks](../apps/desktop-gpui/README.md) independently of the pnpm workspace.

Stage 4 uses Blaze to lock the native WebRTC archives for Linux and Windows. The [SDK preparation workflow](../apps/desktop-gpui/README.md#prepare-the-pinned-webrtc-sdk) verifies and caches those archives for Cargo. The [Blaze evaluation](evidence/stage-4-blaze.md) records compiler compatibility.

Gradle and Xcode own the [mobile builds](../apps/mobile/README.md). The same Xcode project has a [macOS target](../apps/macos/README.md) that builds without Gradle or Kotlin. The [Rust terminal client](../apps/terminal/README.md) pins Ratatui and LiveKit in a separate Cargo lockfile and shares the microphone publication policy with GPUI.

Pin pnpm, Node, Bun, Go, and build-tool versions independently. Use `pnpm-workspace.yaml` with `apps/*`, `packages/*`, and `server` when using its wrapper described below. Use `workspace:*` for local JS/TS dependencies. Commit one pnpm lockfile; retain language-native manifests such as `go.mod`/`go.sum`. Do not run `bun install` or generate a second JS lockfile. Disable Bun runtime auto-install so missing dependencies fail instead of bypassing pnpm's resolved graph. Reproducible local verification installs through `pnpm install --frozen-lockfile`.

## Vite versus Vite+

Vite+ is an integrated toolchain, not merely an accelerated Vite switch. Its local package includes Vite/Rolldown, Vitest, Oxlint, Oxfmt, tsdown, and a task runner. It can be installed through pnpm and documents an existing Node.js requirement. Manual integration aligns the Vite core alias and bundled Vitest version through overrides. [Local CLI](https://www.viteplus.dev/guide/local-cli)

Its `vp run` supports workspace dependency ordering and caching. That overlaps with Turbo's repository-level responsibility. Direct commands such as `vp build` differ from scripts such as `vp run build`; Astro still needs its Astro command. [Task runner](https://www.viteplus.dev/guide/run)

| Option                                    | Assessment for Yapper                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Vite + standalone Oxc tools + Turbo       | Selected at Stage 0 for explicit roles and independent upgrades                                                                 |
| Vite+ as local frontend toolchain + Turbo | Not selected: integrated commands require additional compatibility checks and separation of repository caching responsibilities |
| Vite+ replacing Turbo                     | Not selected for the requested mixed-language orchestration                                                                     |

The decision is based on integration cost. Adopting Vite+ would require a separate documented toolchain decision and compatibility verification for the JS/TS workspace, including Astro, TypeScript checks, and `@shadcn/lint`. Stage 1 switches formatting to Bun. The repository uses standalone Oxlint for linting, Vite for Web builds, and Turbo for task scheduling.

## Turborepo and other languages

Turborepo 2.11, released September 18, 2026, adds experimental native discovery for Cargo, uv, and Go workspaces. It can combine their dependency graphs with JavaScript workspaces. Native Go/Rust support is real, but remains experimental; this announcement does not establish native Swift or Gradle discovery. [Release announcement](https://turborepo.dev/blog/2-11)

The private `server/package.json` adapter exposes `go test -race ./...`, `go vet ./...`, and an explicit build to `server/bin/yapper`. Go owns compilation and module dependencies. [Multi-language guide](https://turborepo.dev/docs/guides/multi-language)

Cargo, Gradle, and Xcode run independently. Any later change to task discovery needs checks for package selection, artifact restoration, filtering, and cross-language dependencies.

## Task graph and cache correctness

Turbo schedules tools; it does not replace their native caches or guarantee correctness without declared dependencies.

- Declare API generation as a prerequisite of its consumers. Changes to the shared OpenAPI/event contract must invalidate generated clients and their dependent builds, including changes originating in Go.
- Scope outputs to actual artifacts such as `dist/**` or `bin/**`; do not cache database state, credentials, or signing material.
- Include source, lockfiles, shared configuration, contract files, relevant environment values, compiler versions, and target platform in the applicable task inputs/cache identity.
- Keep development/watch tasks persistent and uncached. Migrations, backup/restore, deployment, signing, publishing, and live-service integration/voice tests are uncached side-effecting tasks.
- Cache deterministic builds and isolated tests only after checking invalidation. Go test result caching is separate; force execution where acceptance tests must actually run.
- Start with local Turbo caching. Remote caching is optional development infrastructure and creates no production dependency on Vercel.
- Use affected-task selection only after proving the graph with cross-package changes and a valid Git base after history reset. Release validation still runs all mandatory checks.

Use root `pnpm dev`, `pnpm build`, `pnpm test`, and `pnpm typecheck` to run the configured tasks. The artifact-producing wrappers include toolchain and platform information in the cache identity. Run lint, formatting, and API generation checks using the root scripts.

## Containers and acceptance gates

Use separate build and runtime stages. pnpm installs AUTH dependencies during image preparation; the final AUTH image contains Bun and a complete production dependency tree, including workspace dependencies. Verify that pnpm symlinks remain valid in the final image. Go ships its compiled executable. Built Web/landing assets do not require a Vite dev server in production. Turbo is not a production process supervisor.

The [Stage 0 evidence](evidence/stage-0.md) records the baseline checks for installation, task selection, and cache behavior. Native artifacts must not be reused across incompatible OS/architecture/toolchain combinations.

Additional references: [pnpm workspaces](https://pnpm.io/workspaces), [Bun auto-install behavior](https://bun.sh/docs/runtime/auto-install), [Vite guide](https://vite.dev/guide/).
