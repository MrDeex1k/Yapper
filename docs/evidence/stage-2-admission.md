# Stage 2 admission controls

Implemented on `feat/stage-2-community` above the Stage 1 baseline at `56d9bb7`. The owner can open or close guest admission, create invitation codes with independent expiry and use limits, list invitation metadata, and revoke codes. The default request keeps the Stage 1 response and its 24-hour, one-use invitation. The database migration preserves existing invitation codes and membership.

## Verification

- The PostgreSQL 19 integration suite exercised the migration from the original invitation schema, concurrent redemption with a three-use cap, unlimited invitations, expiry, repeat revocation, owner authorization, and membership continuity after closing admission. The suite ran with the Go race detector and with LiveKit 1.13.11.
- A fresh local Compose smoke run exercised owner and guest requests through Caddy, AUTH and Go. It checked code creation, list access and revocation, mode changes, legacy admission, chat, and persistence after restart. The macOS Electron development client passed guest join and restore on that installation.
- `pnpm check` passed. React Doctor scored the changed React files 100/100. Visual and interaction checks of the owner panel in a browser, Windows and Rocky Linux behavior, and the public two-device Stage 1 voice test remain separate acceptance work.

This completes the first work item in the [Stage 2 plan](../stage-2-plan.md). The GPUI prototype and full Electron UI parity remain planned for their respective stages.

## Invitation query pilot

The Web owner panel uses TanStack Query 5.108.2 for invitation metadata. The query client belongs to the active conversation identity. Invitation metadata is discarded when the panel closes, and generated invitation codes stay in local panel state.

- Playwright against Stage 2 Compose on macOS verified the initial list, manual refresh, and a fresh list request after both creation and revocation. The list displayed the new invitation and its revoked status.
- A simulated `403` on a subsequent refresh displayed an error and hid cached rows. A real guest session sent no invitation-list request during normal use, and the server returned `403` to a direct request from that guest.
- `pnpm check` passed. React Doctor reported seven pre-existing warnings and no new ones. This run covered Chromium on macOS. Electron and native desktop behavior were outside this verification run.
