# Stage 2 channel management evidence

Verified locally on macOS arm64 with the Stage 2 dependency baseline, Go 1.27.4, PostgreSQL 19 and LiveKit 1.13.11. The channel-management revision is `783024e` on `feat/stage-2-community`.

- Owners can create, rename and order categories and text/voice channels. Channel order is relative to channels of the same type and category. Connected clients refresh the catalog on the version 1 WebSocket event and when reconnecting.
- PostgreSQL integration exercised migration with populated default channels, owner-only mutations, category and channel reorder, preserved message IDs and history after archival, denied writes and voice grants after archival, and revocation of an existing media grant. Archived text channels are read-only. Archived voice channels are removed from voice navigation.
- The WebSocket integration observed `catalog.changed` on an active guest socket. Real LiveKit signaling and RoomService in the [moderation integration run](stage-2-moderation.md) verified that archiving closed an active voice session.
- The container smoke exercised catalog mutations through Caddy. Repository format, lint, generated contract, type, test and build checks passed. React Doctor reported 100/100 for the channel changes.
- The English and Polish client panel shares the existing Web/Electron renderer. A manual responsive and keyboard walkthrough and live two-device voice archival remain platform acceptance work.

## Web channel editor forms

The Stage 2 editor uses React Hook Form 7.92.0 with Zod 4.6.7 and `@hookform/resolvers` 7.0.7 for creating and editing channels. Go remains authoritative for writes. The resolver pin satisfies the repository's minimum release age at implementation time.

- Three schema tests verified trimming, the Unicode length limit, control characters, channel kinds, and allowed category ID formats. All 11 Web tests and `pnpm check` passed.
- Playwright in Chromium on macOS verified localized field errors and validation focus without a write, real voice-channel creation, rename, category reassignment and archival through the Stage 2 Compose ingress. A simulated `503` preserved the draft and a real retry succeeded.
- At a 390-pixel viewport, the discard confirmation fit the page. Keeping the draft returned focus to the channel selector, confirming discarded the draft, and switching after a successful save skipped confirmation. This browser check used mobile viewport emulation.
- React Doctor reported 76/100 and six pre-existing warnings, down from seven. The Vite entry bundle grew from 294.32 kB to 331.46 kB gzip in the local build and retains its chunk-size warning.
