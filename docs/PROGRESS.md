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

| F02-E05 | `test/prepare-chat-release` | pending | Real PostgreSQL/race integration suite passed. Browser sign-in and message send passed. Backup restored one local account and one message into a NEW database without modifying the live instance. Published release upgrade remains pending; no version was published. |

| F03-E01 | `feat/implement-media-service` | pending | Local SFU started and two Go participants exchanged Opus RTP. Go builds/tests passed. SDK protocol pinned to its compatible version after detecting an upstream mismatch. WAN audio, acoustic quality and relay-only TURN remain explicitly pending. |

| F03-E02 | `feat/authorize-voice-rooms` | pending | Go/PostgreSQL race suite passed. Signed grant tests verify room scope, microphone-only publication and no data publishing. A fake SFU verifies allowed sessions remain and revoked sessions are removed; actual SFU local RTP was verified in the previous stage. Network-partition revocation is explicitly eventual. |

| F03-E03 | `feat/implement-voice-client` | pending | Frontend build/lint/typecheck passed. React Doctor: 100/100 after cleanup and state fixes. LiveKit is isolated in a lazy voice chunk. Real microphone, Bluetooth and cross-browser acoustic checks remain platform acceptance; local RTP transport is verified. |

| F03-E04 | `fix/recover-voice-sessions` | pending | Frontend lint/typecheck and React Doctor passed at 100/100. PostgreSQL/race tests and bounded-queue tests passed. Physical device hot-unplug, Bluetooth and WAN transition tests remain explicit platform acceptance. |

| F03-E05 | `test/prepare-voice-release` | pending | Go RTP test: 30 seconds and forced SFU removal passed. Chrome synthetic microphone join/mute/leave passed. Frontend lint/typecheck/build passed; React Doctor 100/100. WAN, TURN and long group acceptance remain pending. |

| F04-E01 | `feat/implement-desktop-shell` | pending | Local macOS Electron renderer smoke passed; renderer has no Node process. TypeScript and Oxlint passed. Windows/Linux CI is configured; physical platform acceptance is pending. |

| F04-E02 | `feat/integrate-desktop-voice` | pending | TypeScript, Oxlint and React Doctor 100/100 passed. Local Electron startup passed. Fixed Linux executable naming discovered by CI. Physical Windows/X11/Wayland keyboard and tray acceptance remains pending. |

| F04-E03 | `feat/implement-server-moderation` | pending | PostgreSQL integration with race detector passed, including last-admin protection and banned-session rejection. Frontend typecheck, lint and React Doctor 100/100 passed. |

| F04-E04 | `feat/implement-instance-operations` | pending | Local backup and isolated PostgreSQL restore passed checksum and row-count verification. React Doctor 100/100, lint and typecheck passed. Production image upgrade acceptance remains pending. |
