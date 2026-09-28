# Delivery ledger

All entries refer to unmerged work. No phase has been released. Detailed remaining acceptance checks are recorded with each stage.

| Stage | Branch | PR | Validation / remaining evidence |
| --- | --- | --- | --- |
| F01-E01 | `chore/setup-repository` | pending | Workspace and architecture reviewed; documentation only. |

| F01-E02 | `feat/implement-server-lifecycle` | pending | Go tests with race detector and go vet passed. Dependency failure remains distinct from liveness; readiness rejects draining. PostgreSQL is connected in F02. |

| F01-E03 | `feat/implement-web-foundation` | pending | pnpm build, typecheck, lint and format:check passed. React Doctor: 100/100. A deliberately invalid Tailwind value was rejected by shadcn/lint. Astro formatting is explicitly not covered by Oxfmt. |
