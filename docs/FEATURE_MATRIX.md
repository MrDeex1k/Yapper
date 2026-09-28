# Candidate 0.5.0 feature matrix

All implementations are in open, unmerged PRs. No stable binaries or container release is published.

| Capability | Browser | Windows / Linux Electron |
| --- | --- | --- |
| Local accounts, invitations, server selection | Implemented; local Chrome exercised | Shared client; packaged startup passes CI |
| Persistent chat, realtime, search, edits, read state | Implemented; API tests and two-client chat exercised | Shared client; physical end-to-end pilot pending |
| Private channels, roles, bans | Implemented; PostgreSQL permission tests | Shared client; same server authorization |
| Authenticated attachments | Upload/download exercised, byte comparison passed | Shared implementation; physical download acceptance pending |
| Voice, mute/deafen, device selection | Synthetic Chrome and RTP checks passed | Integrated; real devices and Bluetooth pending |
| Focused V push-to-talk | Implemented; typing and deafen guards | Shared behavior |
| Global hold-to-talk | Unavailable | Opt-in F8/F9/F10 on Windows/X11; Wayland fallback; physical key release test pending |
| Camera and screen publication | Synthetic publication and remote decode passed | Capture picker implemented; physical source/camera tests pending |
| Incoming video | Four per page, adaptive layers, visibility unsubscribe, pause/resume | Shared implementation |
| System audio sharing | Disabled | Disabled |
| Tray / active-call close prompt | Unavailable | Implemented; physical desktop acceptance pending |
| Signing / automatic updates | Host serves web app | Unsigned CI artifacts; updater not implemented |

Native Swift, Kotlin and Rust clients begin after F05 and have not been implemented. GPUI is a graphical UI option, while Ratatui is the terminal UI option. No E2EE, federation, unbounded capacity, or complete Discord feature parity is claimed. WebRTC transport encryption is not end-to-end encryption against the SFU.

Browser capture requires an appropriate secure context and platform support; localhost is used in development. Public TLS, UDP reachability and TURN are operator deployment work, with WAN acceptance still pending. See [media deployment](MEDIA.md) and [verification](verification/F05.md).
