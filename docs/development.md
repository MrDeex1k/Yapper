# Development workflow

## Language and repository structure

Use English for source identifiers, comments, documentation, branches, and commits. Product copy is localized in English and Polish.

Proposed monorepo layout, to be created in Stage 0:

```text
apps/web/          React application and administration UI
apps/desktop/      Electron main/preload processes and packaging
apps/auth/         Bun, Elysia 2 Beta, Better Auth
apps/landing/      Astro project website
packages/ui/      Shared design-system components
packages/i18n/    Shared UI translations and locale helpers
packages/api/     Generated TS contracts and client transport
server/           Go application module
deploy/           Compose, ingress, and deployment configuration
scripts/          Development and operational commands
docs/             Specifications, plans, and decision records
```

Use pnpm workspaces and one committed `pnpm-lock.yaml` for JS/TS dependency installation. Bun remains the AUTH runtime, not the package manager. Turborepo orchestrates repository tasks; standard Vite builds the React client. See [Approved toolchain](toolchain.md) for tool ownership, runtime boundaries, and Go integration. Add future native clients only when their stage starts.

## Required skills and documentation

These workflow requirements were requested by the owner on 2026-09-29. Resolve skills through the current agent skill catalog rather than hard-coding one machine's plugin-cache paths.

- **Interfaces — `frontend-skill`:** read and apply it before creating or substantially changing the Web client, Electron renderer, administration UI, or Astro landing. Before implementation, state a visual thesis, content/layout plan, and interaction thesis. Use its application-specific guidance for working surfaces and landing-specific guidance for the marketing page. Preserve Base UI components, EN/PL copy, keyboard accessibility, and reduced-motion preferences.
- **Current library documentation — Context7:** resolve the library ID, then query the relevant API or integration for the project's pinned version. Verify version coverage, particularly for Elysia 2 Beta; a returned example is not proof that it applies to the installed version. If coverage is missing or outdated, consult official documentation, release notes, or source and record the gap. Keep secrets and private project data out of external documentation queries.
- **Go idioms — `modern-go-guidelines:use-modern-go`:** before writing, modifying, fixing, or refactoring Go code, run the skill wrapper's `list` command for the target file or established Go version. Read its complete, unfiltered output. Use `explain` for specific guideline IDs when needed, including before skipping an apparently relevant guideline. Follow the version-specific guidance; this check does not replace compilation and tests.
- **Go engineering — `engineering-skills-for-go`:** read the skill matching the actual work before applying its workflow. Use the routing table below rather than loading all skills for every Go edit.

| Work | Skill |
| --- | --- |
| Local types, errors, interfaces, generics, and data | `go-language-engineering` |
| Packages, modules, exported APIs, and compatibility | `go-project-and-api-design` |
| HTTP, WebSocket integration boundaries, request lifecycle, and shutdown | `go-service-boundaries` (within its documented scope) |
| Authentication/authorization, input handling, secrets, and exploit prevention | `go-security-hardening` |
| Test design, race checks, fuzzing, and deterministic verification | `go-testing-and-verification` |
| Health, telemetry, process lifecycle, and releases | `go-production-operations` |
| Measured CPU, memory, latency, and contention issues | `go-performance-and-diagnostics` |
| Reviewing a Go change | `review-go-engineering-change` |

Read each skill's actual instructions when invoked. If a required capability is unavailable, report the concrete limitation and continue independent work; do not claim that the skill, documentation lookup, or CLI check was performed.

## Branches and squash commits

Branch names must not contain `codex` in any letter case. Use a short English description derived from the intended squash-commit subject:

| Squash commit title | Branch |
| --- | --- |
| `feat: implement auth` | `feat/implement-auth` |
| `feat: implement stage 1` | `feat/implement-stage1` |
| `fix: restore voice after reconnect` | `fix/restore-voice-after-reconnect` |
| `docs: define implementation plan` | `docs/define-implementation-plan` |

Prefer one coherent change per branch. `feat/implement-stage1` is permitted, but large stages should normally be split into smaller reviewable branches. Supported prefixes include `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`, and `ci/`.

Use squash & merge for pull requests. The final squash title describes the resulting change and follows the type/subject convention above. Update branch/PR wording when scope changes; mechanical word-for-word matching is unnecessary. Keep the main branch linear; merge commits are not used.

When repository configuration is implemented, enable squash merging, disable merge-commit merging and rebase merging for PRs, and require relevant CI checks. The one-time new-history initialization is separate from normal PR work.

## JavaScript and TypeScript quality

- Oxlint is the JS/TS linter for AUTH, Web, Electron, shared packages, and applicable landing source.
- Oxfmt is the formatter for supported source/configuration files. Verify `.astro` support in the pinned version; document any narrowly scoped Astro formatter instead of claiming unsupported coverage.
- `@shadcn/lint` enforces UI design-system rules through Oxlint. It applies to UI consumers, not unrelated AUTH backend code.
- Begin with centralized tokens, static classes, and component variants. Enable rules such as `no-restyle`, `no-raw-colors`, `no-arbitrary-values`, and `require-static-classes` after verifying compatible configuration. Scope exceptions to design-system internals where necessary.
- Use shadcn/ui's Base UI variant consistently. Keep application-specific variants in the shared UI package.
- Type checking is a separate check; lint and formatting do not replace it.
- Enforce EN/PL translation-key parity and test language switching. Keep user-facing API errors represented by stable codes translated by clients.

The [shadcn lint documentation](https://github.com/shadcn-ui/lint) inspected during planning requires Oxlint 1.80 or newer and describes its JS plugin API as alpha. Pin and test compatible versions rather than relying on floating upgrades.

## Verification and CI

Stage 0 creates real commands for format checking, lint, type checking, tests, and builds; commands are not available in this documentation-only state.

JS/TS CI checks formatting, lint, types, translation parity, and relevant unit/integration tests. Go CI uses formatting, static analysis, tests, and race testing for concurrency-sensitive code. Test contracts between AUTH, Go, and clients against real services where mocks would hide compatibility failures.

Use browser end-to-end tests for setup, joining, chat, roles, and language switching. Media verification includes real devices and actual microphone/network behavior; fake media and browser automation alone are insufficient.

Build container images and validate Compose configuration. Build Electron packages on the corresponding Windows and macOS runners. Publish artifacts only through an intentional release workflow. Versions and image references are pinned; runtime manifests must not depend on a moving `latest` tag.

For each PR, state the resulting behavior, relevant tests and evidence, migration impact, and any remaining platform limits. A skipped or unavailable check is reported as unverified.
