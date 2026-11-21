# Stage 2 channel management evidence

Verified locally on macOS arm64 with the Stage 2 dependency baseline, Go 1.27.4, PostgreSQL 19 and LiveKit 1.13.11. The source revision is the channel-management commit on `feat/stage-2-community`.

- Owners can create, rename and order categories and text/voice channels. Channel order is relative to channels of the same type and category. Connected clients refresh the catalog on the version 1 WebSocket event and when reconnecting.
- PostgreSQL integration exercised migration with populated default channels, owner-only mutations, category and channel reorder, preserved message IDs and history after archival, denied writes and voice grants after archival, and revocation of an existing media grant. Archived text channels are read-only. Archived voice channels are removed from voice navigation.
- The English and Polish client panel shares the existing Web/Electron renderer. A manual responsive and keyboard walkthrough and live two-device voice archival remain platform acceptance work.
