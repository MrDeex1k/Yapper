# Stage 2 acceptance

On 2026-11-21, the Stage 2 branch passed the community and native prototype gates. The acceptance run used the code at `1e73cdd` (including Web changes at `65c113f`), macOS arm64, OrbStack, Node 26.13.1, pnpm 12.21.0, Bun 1.4.5, Go 1.27.4, PostgreSQL 19, and LiveKit 1.13.11.

| Area | Verified outcome |
| --- | --- |
| Repository checks | `pnpm check` passed formatting, lint, OpenAPI consistency, type checking, tests, and builds. Turbo reused matching cached tasks. Compose also built the current Web, AUTH, and Go images from the working tree. |
| Admission and catalog | Fresh PostgreSQL tests verified concurrent invitation redemption within the use cap, expiry, revocation, migration from the earlier schema, and membership continuity. The ingress smoke verified owner-only administration and read-only archival. |
| Moderation and recovery | The race-enabled Go suite exercised role changes, active WebSocket invalidation, kick and reconnect, forced microphone mute, and real LiveKit room switching and recovery. The ingress smoke confirmed role changes with an existing token and moderation through the deployed services. |
| Message lifecycle | The race-enabled Go suite covered ordering, retry deduplication, message edits and deletions, and retention with populated history. The ingress recheck after a container restart restored the same guest identity and message history. |
| Web interaction | A local Chrome session at 1200 × 800 opened the recent 50 messages at the latest entry. Tab and Enter reached and loaded older history, with all 55 fixture messages present in order. A 390 × 844 viewport verified keyboard operation of the channel drawer, read-only archived chat, no horizontal overflow, and locale persistence across reload. |
| Native GPUI | The locked Windows x64 build and Linux X11 layout checks passed. The maintainer confirmed two-way Windows GPUI to macOS Brave audio and foreground push-to-talk with the physical microphone on Windows. The Windows client also sent a message through the Stage 2 API. See the [native report](stage-2-gpui.md). |

The first race-enabled media integration run received a transient `twirp error unavailable: no response from servers` from LiveKit during automatic grant recovery. Five subsequent runs of the media suite and one full repeat passed. Record any recurrence with the LiveKit service logs.

The Chrome mobile check used viewport emulation. The full release browser and device matrix, Linux microphone acceptance, desktop packaging, and one-to-one GPUI/Web parity are Stage 4 release checks. The Stage 2 prototype covers guest sessions, basic text chat, and foreground voice.
