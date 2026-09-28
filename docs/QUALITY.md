# JavaScript and UI checks

Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, and `pnpm build` before opening a frontend PR. `pnpm format` and `pnpm lint:fix` are local repair commands, never automatic CI mutations.

Oxlint includes @shadcn/lint for Tailwind v4. Arbitrary class values and restyling shared components outside their variants are errors. Component definitions may define their own appearance. A temporary TSX fixture with `p-[13px]` was rejected by `shadcn/no-arbitrary-values`; the fixture was removed after the probe.

Oxfmt 0.70 does not format `.astro` files in this configuration. `astro check` validates the landing; `.astro` formatting is manual until a supported integration is selected. Do not report skipped files as formatted. Build products and the roadmap checklist are excluded from automatic formatting.

React Doctor is run through `npx react-doctor@latest --verbose --scope changed` on staged/committed React changes. The initial client scored 100/100. Type checking remains separate. Go auth continues to use Go tests, vet and race checks.
