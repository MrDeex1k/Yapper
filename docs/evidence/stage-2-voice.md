# Stage 2 voice controls evidence

Local checks on 2026-11-21 used macOS arm64, Electron 45.4.1, LiveKit JS 2.25.0, LiveKit Server 1.13.11 and PostgreSQL 19 in OrbStack. The same React renderer serves browsers and Electron.

- The connected room exposes microphone selection and, when supported, audio output selection. The browser exposes device names after the applicable permissions are granted. A browser without output selection uses its system output. On browsers with a device picker, the user can grant permission to another output. The [audio output selection API](https://developer.mozilla.org/en-US/docs/Web/API/Audio_Output_Devices_API) defines the browser and permission boundary.
- The active speaker list identifies speaking participants and exposes local listening volume per remote participant. The session retains a participant's volume across room switches and changes of the LiveKit connection identity.
- Push-to-talk responds to holding the control or Space in the foreground. The client releases on key/pointer release, focus or visibility loss, deafen, moderation and reconnect. Audio tracks captured after a release are stopped before publication. Reconnect and microphone changes leave the microphone muted until the user acts again.
- Web tests with simulated devices and LiveKit events covered leaving a pending connection, rapid channel switching, one fresh grant after terminal network failure, moderation, microphone permission denial, release during capture permission, input/output switching and per-participant volume across identity changes.
- The PostgreSQL and real LiveKit integration verified removal from the previous room, rejection of replayed and stale grants, failure recovery for outstanding removals, rejection of a moderated grant's automatic recovery, and forced mute with subscribe-only access. The Compose smoke and native macOS Electron guest join and restore also passed.

The repository check passed for formatting, lint, API consistency, type checking, tests and builds. The full React Doctor scan reported the same seven warnings as the preceding message-lifecycle revision.

The microphone, speaker device and audio quality checks on physical setups are pending. Test keyboard and touch interactions, mobile audio permissions, output routing, and two participants across public networks. The foreground shortcut applies to the Web/Electron renderer. Global push-to-talk and native GPUI client validation belong to later work.
