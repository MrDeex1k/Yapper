# JavaScript and UI checks

Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, and `pnpm build` before opening a frontend PR. `pnpm format` and `pnpm lint:fix` are local repair commands, never automatic CI mutations.

Oxlint includes @shadcn/lint for Tailwind v4. Arbitrary class values and restyling shared components outside their variants are errors. Component definitions may define their own appearance. A temporary TSX fixture with `p-[13px]` was rejected by `shadcn/no-arbitrary-values`; the fixture was removed after the probe.

Oxfmt 0.70 does not format `.astro` files in this configuration. `astro check` validates the landing; `.astro` formatting is manual until a supported integration is selected. Do not report skipped files as formatted. Build products and the roadmap checklist are excluded from automatic formatting.

React Doctor is run through `npx react-doctor@latest --verbose --scope changed` on staged/committed React changes. The initial client scored 100/100. Type checking remains separate. Go auth continues to use Go tests, vet and race checks.

## Dependency updates and publication delay

Use pnpm 12.6.0 from the root `packageManager` field. `pnpm-workspace.yaml` sets `minimumReleaseAge: 180` (minutes) and `minimumReleaseAgeStrict: true`. Registry releases must be at least three hours old before pnpm accepts them, including transitive dependencies and locked versions. No package is exempted. Use `pnpm install --frozen-lockfile` in CI; npm/yarn do not enforce this pnpm policy. The delay is a risk reduction measure, not a security certification. See [pnpm dependency resolution settings](https://pnpm.io/settings/dependency-resolution#minimumreleaseage).

Update every workspace with `pnpm -r update --latest` and root tools with `pnpm -w update --latest`, then run the checks above and `pnpm peers check`. Transitive packages must remain within the ranges required by their parents; do not force incompatible majors through global overrides.

The current update uses React 19.3.0, Base UI 1.8.0, Tailwind 4.3.3, Vite 8.3.1, Astro 7.3.5 and Go 1.27.1. The React client uses TypeScript 7.0.2, with Vite asset types and no removed `baseUrl` option. Exception: the landing uses TypeScript 6.0.3, the newest supported 6.x release, because the latest `@astrojs/check` 0.9.10 explicitly rejects TypeScript 7. Keep this exception visible in `pnpm outdated`; revisit it when a stable Astro checker supports TypeScript 7. Do not suppress its peer constraints or use the experimental mapper as part of a routine dependency update.
