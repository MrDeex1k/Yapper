# Approved monorepo toolchain

Approved on 2026-09-29: **pnpm + Turborepo + standard Vite, with Bun as the AUTH runtime**. This is the implementation baseline. Vite+ is not part of the selected stack; the comparison below records why. Pinned tools and executed compatibility checks are recorded in [Stage 0 evidence](evidence/stage-0.md).

## Tool ownership

| Layer                 | Tool                                   | Responsibility                                             |
| --------------------- | -------------------------------------- | ---------------------------------------------------------- |
| JS/TS dependencies    | pnpm                                   | Workspace linking, installation, lockfile                  |
| Repository tasks      | Turborepo                              | Ordering, parallelism, filtering, task-result cache        |
| React client          | Vite                                   | Development server and production browser/renderer bundles |
| Landing               | Astro CLI                              | Astro development/build pipeline                           |
| AUTH execution        | Bun                                    | Elysia 2 Beta and Better Auth runtime                      |
| Tooling execution     | Pinned supported Node.js               | Frontend tooling and desktop packaging where expected      |
| Desktop execution     | Electron                               | Its bundled Chromium/Node runtime                          |
| Quality               | Oxlint, Oxfmt, TypeScript, shadcn lint | Separate lint, formatting, types, and UI policy            |
| Backend/native builds | Go, later Cargo, Xcode and Gradle      | Language-specific compilation and dependencies             |
| Deployed services     | Docker Compose                         | Runtime lifecycle and networking                           |

pnpm's `run`/`exec` may launch a local command; that does not make pnpm an application runtime. Root scripts delegate repository scheduling to Turbo. AUTH scripts explicitly invoke Bun, for example `bun --watch src/index.ts` or `bun src/index.ts`. Browser JavaScript runs in the browser, and Electron does not become a Bun application.

Pin pnpm, Node, Bun, Go, and build-tool versions independently. Use `pnpm-workspace.yaml` with `apps/*`, `packages/*`, and `server` when using its wrapper described below. Use `workspace:*` for local JS/TS dependencies. Commit one pnpm lockfile; retain language-native manifests such as `go.mod`/`go.sum`. Do not run `bun install` or generate a second JS lockfile. Disable Bun runtime auto-install so missing dependencies fail instead of bypassing pnpm's resolved graph. CI installs through `pnpm install --frozen-lockfile`.

## Vite versus Vite+

Vite+ is an integrated toolchain, not merely an accelerated Vite switch. Its local package includes Vite/Rolldown, Vitest, Oxlint, Oxfmt, tsdown, and a task runner. It can be installed through pnpm and documents an existing Node.js requirement. Manual integration aligns the Vite core alias and bundled Vitest version through overrides. [Local CLI](https://www.viteplus.dev/guide/local-cli)

Its `vp run` supports workspace dependency ordering and caching. That overlaps with Turbo's repository-level responsibility. Direct commands such as `vp build` differ from scripts such as `vp run build`; Astro still needs its Astro command. [Task runner](https://www.viteplus.dev/guide/run)

| Option                                    | Assessment for Yapper                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Vite + standalone Oxc tools + Turbo       | Selected: explicit roles and independent upgrades; more configuration to maintain                                               |
| Vite+ as local frontend toolchain + Turbo | Not selected: integrated commands require additional compatibility checks and separation of repository caching responsibilities |
| Vite+ replacing Turbo                     | Not selected for the requested mixed-language orchestration                                                                     |

The decision is based on integration cost, not a measured speed advantage. Adopting Vite+ would require a separate documented toolchain decision and compatibility verification for Astro, Electron, TypeScript checks, and `@shadcn/lint`. The current implementation uses standard Vite and standalone Oxc tools, with Turbo as the repository task scheduler.

## Turborepo and other languages

Turborepo 2.11, released September 18, 2026, adds experimental native discovery for Cargo, uv, and Go workspaces. It can combine their dependency graphs with JavaScript workspaces. Native Go/Rust support is real, but remains experimental; this announcement does not establish native Swift or Gradle discovery. [Release announcement](https://turborepo.dev/blog/2-11)

For the initial single Go module, use a small private `server/package.json` task adapter, included in pnpm's workspace. It exposes commands such as `go test ./...`, `go vet ./...`, and an explicit binary build to a declared output directory. Go still owns compilation and module dependencies. This uses the documented generic integration mechanism. [Multi-language guide](https://turborepo.dev/docs/guides/multi-language)

Alternatively, Stage 0 can evaluate native Go discovery with a root `go.work` and `experimentalGoWorkspaces` on a pinned release. Validate package discovery, artifact restoration, filtering, and cross-language dependencies first. Choose one discovery mechanism per project; avoid registering the same module through both mechanisms. Revisit Cargo integration when the TUI stage starts. Swift and Kotlin tasks can later call native build tools on appropriate CI runners without requiring native graph discovery.

## Task graph and cache correctness

Turbo schedules tools; it does not replace their native caches or guarantee correctness without declared dependencies.

- Declare API generation as a prerequisite of its consumers. Changes to the shared OpenAPI/event contract must invalidate generated clients and their dependent builds, including changes originating in Go.
- Scope outputs to actual artifacts such as `dist/**` or `bin/**`; do not cache database state, credentials, or signing material.
- Include source, lockfiles, shared configuration, contract files, relevant environment values, compiler versions, and target platform in the applicable task inputs/cache identity.
- Keep development/watch tasks persistent and uncached. Migrations, backup/restore, deployment, signing, publishing, and live-service integration/voice tests are uncached side-effecting tasks.
- Cache deterministic builds and isolated tests only after checking invalidation. Go test result caching is separate; force execution where acceptance tests must actually run.
- Start with local Turbo caching. Remote caching is optional development infrastructure and creates no production dependency on Vercel.
- Use affected-task selection only after proving the graph with cross-package changes and a valid Git base after history reset. Release validation still runs all mandatory checks.

Planned entry points after scaffolding are `pnpm exec turbo run dev`, `pnpm exec turbo run build`, and `pnpm exec turbo run lint typecheck test`. Package scripts invoke the correct underlying runtime/tool. Exact task names and commands become authoritative in the manifests once implemented.

## Containers and acceptance gates

Use separate build and runtime stages. pnpm installs AUTH dependencies during image preparation; the final AUTH image contains Bun and a complete production dependency tree, including workspace dependencies. Verify that pnpm symlinks remain valid in the final image. Go ships its compiled executable. Built Web/landing assets do not require a Vite dev server in production. Turbo is not a production process supervisor.

Before completing Stage 0, verify a clean frozen install, AUTH under Bun, Web and Astro builds, Electron packaging compatibility, Go task selection, cache hit on repetition, cache miss after relevant source/config/contract changes, and restoration of deleted build outputs. Native artifacts must not be reused across incompatible OS/architecture/toolchain combinations.

Additional references: [pnpm workspaces](https://pnpm.io/workspaces), [Bun auto-install behavior](https://bun.sh/docs/runtime/auto-install), [Vite guide](https://vite.dev/guide/).
