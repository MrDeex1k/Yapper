# Stage 4 desktop test record

## LAN conversation on 2026-11-23

The maintainer joined Lounge using Web on macOS and the installed GPUI 0.1.0 Windows x64 release on PC-Jakub. Both clients used the local Stage 4 server on branch `feat/stage-4-desktop-release`, based on `466c2f1` with unpublished Stage 4 changes. The maintainer confirmed that voice communication worked and reported that the GPUI behavior and appearance were acceptable in this session.

The maintainer observed a brief empty-history message when switching Web text channels. The regression check defers history responses and verifies that a populated channel shows its messages without a false empty state, and that the empty state appears once a genuinely empty response arrives. `pnpm check` passed, including all 19 Web tests. The rebuilt Web bundle was served on the LAN endpoint and matched the local build's SHA-256.

This session covers LAN voice and a GPUI walkthrough. The remaining device, TURN/TLS, and package lifecycle checks are listed in [Desktop acceptance](../validation.md#desktop-acceptance).

## GPUI message actions

Edit and delete now appear next to the author. The editor opens in the message row and retains the existing per-channel draft handling. Delete uses an inline confirmation. Both panels use the Web accent colors. GPUI already distinguishes a pending history request from an empty timeline.

On Ubuntu ARM64, the locked format check, Clippy with warnings denied, all three ordinary tests, and the offline release build passed. The release process started under Xvfb.

On PC-Jakub, the updated Windows x64 release built from snapshot `be1650d12d25c57c56907e7028cf78af486cb08e8f9d9a7097b53a616c3854c5`, restored its guest session, and displayed the history in `#general`. The visible message belonged to another participant. Visual acceptance of the buttons and panels on a message owned by the local guest is pending.

The next polish pass added violet edit and red delete hover states and grouped the outlined Cancel and Save buttons below the edit field. A semibold heading identifies the editor. Formatting, Clippy, all three ordinary tests, and the offline release build passed on Ubuntu ARM64. Windows x64 built from snapshot `eaa75d98861d9d0d6c45dcddecbca29aed8df4efdd3ec42973b492571ce115bd`. On PC-Jakub, both hover states and the Polish editor were verified on the test guest's own message in `#stage4-second`. The editor was left open with the original message text.
