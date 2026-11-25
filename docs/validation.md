# Validation and release evidence

Stages 0 through 3 have passed their scoped acceptance gates. The maintainer closed Stage 4 on 2026-11-24. The first-release client targets are GPUI on Windows and Linux and Web on supported browsers. The [desktop verification record](evidence/stage-4-desktop.md) and checklist below distinguish recorded results from outstanding release checks. See the [Stage 0 evidence](evidence/stage-0.md), the [Stage 1 acceptance record](evidence/stage-1.md#acceptance-run--2026-11-21), and the [Stage 2 acceptance record](evidence/stage-2-acceptance.md).

The [Stage 3 verification record](evidence/stage-3-automated.md#stage-3-implementation-verification) documents the local operational drills and capacity measurements. The maintainer confirmed the Windows GPUI and macOS Web [conversation during load](evidence/stage-3-automated.md#physical-acceptance-under-load).

The [2026-11-21 dependency refresh](evidence/dependency-refresh-2026-11-21.md) records the versions and compatibility exceptions verified in that run. Consult the manifests and lockfiles for current pins. Prior results are in the [2026-10-17 report](evidence/dependency-refresh-2026-10-17.md) and [2026-10-06 report](evidence/dependency-refresh-2026-10-06.md).

Stage 7.5 recorded Go and Rust analysis and repeatable Web smoke results. Linux arm64 ran all three browser projects. See the [verification record](evidence/stage-7-5-verification.md) for platform and coverage limits.

## Evidence format

For each implementation gate, record the source revision, image/package versions, date, environment, steps, observed outcome, and remaining limitations. Use logs or screenshots only when they substantiate the result, and exclude secrets and private message content.

## Functional and authorization scenarios

See the Stage 2 reports for [admission controls](evidence/stage-2-admission.md), [channel management](evidence/stage-2-channels.md), [moderation](evidence/stage-2-moderation.md), [message lifecycle](evidence/stage-2-messages.md), [voice controls](evidence/stage-2-voice.md), and the [GPUI prototype](evidence/stage-2-gpui.md).

| Area          | Required evidence                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Owner setup   | Host-obtained setup token creates one owner; expired/reused tokens and unauthorized setup fail                                                                     |
| Accounts      | Owner/moderator login, logout, recovery, and revoked sessions behave consistently in Web and all first-release desktop clients                                     |
| JWT/JWKS      | Valid token accepted; wrong issuer/audience/algorithm, expiry, unknown key rejected; rotation and cache behavior tested                                            |
| Guests        | Nickname admission creates stable per-server identity; reopening preserves it; clearing client data cannot recover it by nickname                                  |
| Invitations   | Closed mode rejects uninvited admission; concurrent redemption respects use limits; expiry/revocation prevent new admission                                        |
| Open mode     | Address and nickname admit a guest; switching to closed mode changes new-admission behavior                                                                        |
| Channels      | Owners can manage and order channels and categories; IDs/history survive upgrades; changes reach connected clients; archival blocks sends/grants and revokes voice |
| Roles         | Guests cannot administer; moderators cannot change installation ownership or assign privileged roles                                                               |
| Moderation    | Kick, ban, message deletion, and forced mute apply to active WebSocket/media connections and reconnect attempts                                                    |
| Media grants  | Removed users cannot regain publication by replaying an already-issued grant; actual self-hosted behavior is verified                                              |
| Messages      | Persistence precedes acknowledgement; retries do not duplicate; own-message edit/delete and moderator deletion enforced                                            |
| History       | Existing history visible to admitted users; pagination remains correct while new messages arrive; retention removes eligible bodies                                |
| Voice         | Mute/deafen, speaking state, supported device selection, participant volume, foreground push-to-talk, and switching channels work                                  |
| Saved servers | Identities remain isolated; switching cannot leave two active voice conversations                                                                                  |
| Languages     | EN/PL parity, locale persistence, translated errors, keyboard labels, and landing locale routes verified                                                           |

## Capacity gate

Prepare 100 persisted participant records, including test privileged accounts. Exercise 30 concurrent online participants and 20 voice participants across at least two channels with no more than 10 participants in each tested channel. Include text sends, joins/leaves, and reconnects while voice is active.

Implementation default: a 30-minute sustained run after warm-up, plus repeated join/leave cycles. Record host CPU, memory, disk, bandwidth, runtime versions, network conditions, and baseline idle usage. Measure text acknowledgement delay, voice connection time, packet loss, jitter, reconnect outcomes, and resource growth.

Required outcomes: no crash or out-of-memory event, no lost acknowledged messages, no duplicated committed sends, no unauthorized access/publication, and recovery after the tested short interruptions. Real-device listeners must confirm usable conversation; synthetic load alone does not establish audio quality.

Before executing the acceptance run, set quantitative latency/reconnect/resource thresholds using Stage 1 measurements on the declared environment. Record them before seeing the final run results. There is no approved universal capacity or latency claim yet.

## Recovery and operations

- Restore both databases and identity/signing material onto a clean host; verify owner login, existing guest identity, message history, roles, and voice admission.
- Execute the documented manual update from a previous test version; verify data and account continuity.
- Simulate a migration/update failure and execute the documented restore procedure. Confirm the stated recovery point and possible loss since backup.
- Interrupt each service separately. Confirm truthful client status, reconnect behavior, and defined AUTH-outage behavior.
- Test expired TLS material and unreachable JWKS/media endpoints as controlled failure cases. The client must report a meaningful error without accepting invalid credentials or certificates.
- Confirm backup files and diagnostic exports are not anonymously accessible. Ensure logs/exports omit tokens, passwords, and message bodies.

## Platform matrix

At Stage 0, populate exact versions, CPU architectures, and available test devices. At Stage 4, every claimed platform needs recorded evidence.

| Surface                                   | Required checks                                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Desktop Web: Chrome/Edge, Firefox, Safari | Joining, accounts, chat, foreground voice, permissions, reconnect, EN/PL                                       |
| iPhone/iPad Safari                        | Responsive layouts, touch controls, keyboard behavior, foreground chat/voice, microphone permissions           |
| Android phone/tablet Chrome               | Same mobile scenarios, including real microphone and output routing behavior                                   |
| GPUI on Windows                           | Clean install, per-server credentials, microphone, recovery, keyboard navigation, EN/PL, updates and uninstall |
| GPUI on Linux                             | Same desktop scenarios on supported distributions and desktop sessions, with package and audio routing checks  |

Record global desktop push-to-talk and mobile background audio separately. Foreground push-to-talk is the release baseline. Document which platforms support global push-to-talk and surface audio output selection limitations in the client. The first release targets mobile voice while the page is active.

## Desktop acceptance

- See the [Stage 4 desktop test record](evidence/stage-4-desktop.md), the [Blaze evaluation](evidence/stage-4-blaze.md), and the [naming audit follow-up](evidence/stage-4-naming.md).
- At Stage 2, record GPUI and Rust versions, OS and architecture, and Windows native session and origin handling. Verify a real two-way call through the Go signaling endpoint between Windows GPUI and macOS Web. Check the Linux layout and rendering under X11 using Xvfb. Linux physical-device and audio acceptance belongs to Stage 4.
- At Stage 4, validate the installed GPUI packages on Windows and Linux against the same server contract as Web. Verify foreground push-to-talk, microphone permission denial and recovery, device selection where supported, direct media and TURN/TLS, reconnect, and moderation during a call.
- Compare the same screens and states in GPUI and Web at matched viewport sizes and display scaling. Verify layout, typography, colors, icons, keyboard navigation, and responsive behavior as part of the Stage 4 desktop gate.
- Switch between two saved servers and restart each app. Verify that credentials and participant identities stay isolated and that the previous voice session closes. Exercise the documented sign-in or rejoin path from Stage 1 development builds and verify any claimed guest identity preservation.

## First private release checklist

- [ ] Stages 0–3 have evidence for all mandatory gates.
- [ ] GPUI packages on Windows and Linux pass desktop acceptance. Required Web/device combinations have been tested.
- [ ] Core conversation has been tested with real participants, not only simulated media.
- [ ] Installation, upgrade, backup, and restore instructions match the delivered artifacts.
- [ ] EN and PL are complete for the application and landing.
- [ ] Known limits, signing status, supported versions, and performance environment are published with the private release.
- [ ] No claim of E2EE, guaranteed anonymous-ban enforcement, unlimited scalability, or guaranteed mobile background voice is made.

## Native mobile acceptance

Stage 6 clients build for Android and iPhone/iPad and have emulator and simulator evidence. The [mobile acceptance matrix](stage-6-mobile-plan.md#acceptance) defines Android and iOS checks against the existing server. The [mobile verification record](evidence/stage-6-mobile.md) tracks emulator and simulator results separately from real-device audio, background behavior and signing checks.

## Native macOS acceptance

Stage 7 has Apple Silicon build, session restoration, chat, and muted voice-join evidence. Physical two-way audio and clean-machine Gatekeeper installation remain open. See the [Stage 7 verification record](evidence/stage-7-macos.md).

## Terminal client acceptance

The [Stage 8 verification record](evidence/stage-8-terminal.md) tracks results against this matrix. Record the OS, architecture, terminal, credential store, audio devices, server revision, and client build for each macOS, Linux, and Windows run.

| Area               | Required evidence                                                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session            | Open and invitation-only admission work. Restart restores the guest identity. Credentials remain scoped by origin. An unavailable vault produces an explicit temporary-session option.                                                         |
| Chat               | Exchange plain-text messages with an existing client. Retry an uncertain send without duplication. Load older history and reconcile edits, deletions, and retention after reconnect. Archived channels stay read-only.                         |
| Voice              | Join muted, unmute explicitly, and confirm audible speech in both directions with physical microphones. Verify that leave, room switching, and graceful exit end capture and release the old grant.                                            |
| Authorization      | Server checks still apply to channel access, kicks, bans, forced mute, and voice grants. Verify the action surface contains no message editing, deletion, or moderation controls, including for privileged accounts if staff sign-in is added. |
| Terminal and build | Build with locked dependencies and install on a clean target. Check keyboard navigation, resize, EN/PL copy, and terminal restoration after exit and interruption.                                                                             |
