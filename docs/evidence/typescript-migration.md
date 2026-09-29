# JavaScript source migration to TypeScript

Date: 2026-09-29. Base: main `ee997fc` (merged Stage 1 implementation checkpoint). Branch: `refactor/migrate-javascript-to-typescript`. This is a tooling migration; Stage 1's public-network, real-speech and platform acceptance gates remain outstanding.

All 13 previously tracked JavaScript source/configuration files are migrated to `.ts` or `.cts`. Node 24 runs repository scripts with native type stripping. A dedicated strict `tsconfig.scripts.json` checks scripts, including API response types imported from the generated contract, typed Compose fixtures, process options, signals and error handling. The check is part of `pnpm typecheck` and `pnpm check`; no type-check suppression or explicit `any` was introduced.

Astro loads `astro.config.ts`. Electron preload source is `src/preload.cts`, compiled to `dist/preload.cjs`; the native smoke source is `scripts/native-smoke.cts`, compiled to ignored `.test-tools/native-smoke.cjs`. Build copying now handles the renderer only. The native test output is outside the desktop package allowlist, excluded from source lint/format and Docker context, and included in Turbo build outputs so cached builds restore the test entry point. Generated JavaScript remains a runtime artifact rather than committed source.

Executed on macOS arm64 with Node 24.20.0, TypeScript 7.0.2, Electron 44.4.5, Go 1.27.1 and OrbStack:

- `pnpm check` passed formatting, Oxlint/shadcn lint, API contract generation comparison, script/workspace types, existing tests and builds. Astro EN/PL routes built with the renamed configuration. Desktop compilation emitted the CommonJS preload and native harness successfully.
- `pnpm setup:dev` ran as TypeScript and kept the existing `.env`.
- `pnpm test:turn` passed actual TLS routing, authentication, bidirectional relay and peer-policy assertions; containers, networks and generated secrets were removed. Fault injection against the migrated runner preserved the original failure during failed teardown, reported teardown failure after an otherwise successful test and removed temporary fixtures in both cases.
- The TypeScript container smoke script passed on a fresh disposable `yapper-typescript-smoke` installation: setup/login, two guest identities, invite replay rejection, administrative boundary, shared persisted chat, concurrent retry deduplication, ban, revoked session and private ingress denial. Its persistence mode passed after restarting PostgreSQL, AUTH and Go, preserving guest identity and committed history.
- The TypeScript desktop runner launched the compiled native CommonJS harness twice. Guest admission, renderer sandbox/credential isolation, OS-encrypted storage, restored identity/server and rendered conversation passed with the compiled preload. The existing macOS helper sandbox-extension diagnostic remained visible; this does not prove signed-package, microphone or Windows behavior.

Context7 Node 24 native TypeScript and Astro configuration documentation were consulted; builds and execution verified compatibility with the installed versions. AUTH remains on Bun and pnpm remains the sole package manager. Go application behavior is unchanged; its TURN test comment now references the renamed runner. No GitHub Actions workflow was added.
