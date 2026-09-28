# Delivery ledger

All entries refer to unmerged work. No phase has been released. Detailed remaining acceptance checks are recorded with each stage.

| Stage | Branch | PR | Validation / remaining evidence |
| --- | --- | --- | --- |
| F01-E01 | `chore/setup-repository` | pending | Workspace and architecture reviewed; documentation only. |

| F01-E02 | `feat/implement-server-lifecycle` | pending | Go tests with race detector and go vet passed. Dependency failure remains distinct from liveness; readiness rejects draining. PostgreSQL is connected in F02. |

| F01-E03 | `feat/implement-web-foundation` | pending | pnpm build, typecheck, lint and format:check passed. React Doctor: 100/100. A deliberately invalid Tailwind value was rejected by shadcn/lint. Astro formatting is explicitly not covered by Oxfmt. |

| F01-E04 | `feat/implement-compose-deployment` | pending | Docker images built on OrbStack (arm64). Startup and PostgreSQL restart smoke tests passed on localhost:18088. Port 8088 belongs to another project and was left untouched. CI workflow prepared; public TLS remains operator configuration. |

| F01-E05 | `ci/prepare-release-pipeline` | pending | Shell syntax and generated release Compose validation passed. Local browser connection to the Compose server succeeded. Docker Hub credentials, amd64 release smoke and public publication remain unverified and are not claimed complete. |

| F02-E01 | `feat/implement-storage-contract` | pending | Go race tests passed, including duplicate/unknown/trailing/oversized JSON rejection. Compose applied 001_initial.sql on real PostgreSQL and health smoke passed. Migrations preserve applied checksums. |

| F02-E02 | `feat/implement-auth` | pending | Real PostgreSQL integration tests and Go race checks passed: repeated bootstrap, invitation reuse, member invite denial, logout and expired session rejection. Backend auth remains Go; client forms follow in the chat stage. |

| F02-E03 | `feat/implement-persistent-chat` | pending | Real PostgreSQL tests verify deduplicated retries, conflicting retry rejection and persistence across server objects. Frontend lint/typecheck/build passed. React Doctor returned to 100/100 after simplifying AUTH control flow. Live server bootstrap was verified; realtime arrives in F02-E04. |

| F02-E04 | `feat/implement-realtime` | pending | Go race tests against PostgreSQL and real WebSocket connections passed, including initial sync, event delivery, unauthorized subscription and live revocation. Frontend lint/typecheck and React Doctor passed (100/100). Browser login exposed and corrected an HTML pattern compatibility issue. |
