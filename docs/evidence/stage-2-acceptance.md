# Stage 2 acceptance

On 2026-11-21, the Stage 2 branch passed the community and native prototype gates. The acceptance run used the code at `1e73cdd` (including Web changes at `65c113f`), macOS arm64, OrbStack, Node 26.13.1, pnpm 12.21.0, Bun 1.4.5, Go 1.27.4, PostgreSQL 19, and LiveKit 1.13.11.

| Area                    | Verified outcome                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository checks       | `pnpm check` passed formatting, lint, OpenAPI consistency, type checking, tests, and builds. Turbo reused matching cached tasks. Compose also built the current Web, AUTH, and Go images from the working tree.                                                                                                                                       |
| Admission and catalog   | Fresh PostgreSQL tests verified concurrent invitation redemption within the use cap, expiry, revocation, migration from the earlier schema, and membership continuity. The ingress smoke verified owner-only administration and read-only archival.                                                                                                   |
| Moderation and recovery | The race-enabled Go suite exercised role changes, active WebSocket invalidation, kick and reconnect, forced microphone mute, and real LiveKit room switching and recovery. The ingress smoke confirmed role changes with an existing token and moderation through the deployed services.                                                              |
| Message lifecycle       | The race-enabled Go suite covered ordering, retry deduplication, message edits and deletions, and retention with populated history. The ingress recheck after a container restart restored the same guest identity and message history.                                                                                                               |
| Web interaction         | A local Chrome session at 1200 × 800 opened the recent 50 messages at the latest entry. Tab and Enter reached and loaded older history, with all 55 fixture messages present in order. A 390 × 844 viewport verified keyboard operation of the channel drawer, read-only archived chat, no horizontal overflow, and locale persistence across reload. |
| Native GPUI             | The locked Windows x64 build and Linux X11 layout checks passed. The maintainer confirmed two-way Windows GPUI to macOS Brave audio and foreground push-to-talk with the physical microphone on Windows. The Windows client also sent a message through the Stage 2 API. See the [native report](stage-2-gpui.md).                                    |

The first race-enabled media integration run received a transient `twirp error unavailable: no response from servers` from LiveKit during automatic grant recovery. Five subsequent runs of the media suite and one full repeat passed. Record any recurrence with the LiveKit service logs.

The Chrome mobile check used viewport emulation. The full release browser and device matrix, Linux microphone acceptance, desktop packaging, and one-to-one GPUI/Web parity are Stage 4 release checks. The Stage 2 prototype covers guest sessions, basic text chat, and foreground voice.

## PR #30 review fixes

The 2026-11-22 follow-up verified the review fixes with Node 26.13.1, pnpm 12.21.0, Bun 1.4.5, Go 1.27.4, and Rust 1.100.0.

- `pnpm check` passed formatting, lint, OpenAPI generation consistency, type checks, tests, and builds. React Doctor reported 87/100 versus 76/100 for the pre-review branch.
- The AUTH integration used a two-connection PostgreSQL pool and a blocked provisioning transaction. Concurrent provisioning returned a bounded response, active session checks remained available, and a 32-character username with a 128-code-point password could sign in.
- The Go race suite passed against disposable PostgreSQL 19 and LiveKit 1.13.11. It exercised monotonic guest address updates, automatic recovery after a deferred LiveKit removal, ban disconnects, confirmed RoomService removal, and role and retention behavior. It also verified that authorized deletion is available in archived text channels.
- The Compose smoke used real migrations and exercised invitation defaults, partial channel updates, rejected cursor values, pagination above a 32-bit cursor, and moderator role-assignment denial for an eligible registered member. The guest identity and committed message survived a container restart.
- Chrome exercised login with `AbortSignal.any` and `AbortSignal.timeout` unavailable, Unicode catalog names, read-only retry after a committed move, invitation revocation, retention and moderation audit retries, repeated author selection, and edit conflict recovery with the draft intact. The mobile viewport check verified profile order, no horizontal overflow, and archived chat without a composer.
- GPUI passed the Linux arm64 format, strict and pedantic Clippy, unit test, and locked build checks. The opt-in GPUI smoke joined LiveKit through the Go signaling gate and released the grant. The server picker rendered under X11 at 640 × 600.

Physical microphones, two-way speech, and a fresh Windows build were outside this follow-up. The earlier Windows and macOS acceptance applies to the build listed above.

### Second CodeRabbit review

The Web suite passed 18 tests. The new regressions cover aborting stalled session and token JSON bodies at the request deadline, retrying the participant directory independently of the moderation audit, and keeping remote tracks detached while deafened when the simulated SDK restarts playback without a status event. Re-enabling playback attached the current tracks, including a track added during deafen.

`pnpm check` passed and React Doctor remained at 87/100. The WebSocket integration test ran 10 times under `go test -race` against disposable PostgreSQL 19. Each concurrent test accepted exactly one handshake for a fresh event ticket and rejected the other with HTTP 403.

The playback regression used a simulated SDK. Playback on a physical iPhone or iPad was unverified for this change.
