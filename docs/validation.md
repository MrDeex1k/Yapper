# Validation and release evidence

Status: **planned, not executed**. This document defines acceptance work for the implementation; it does not report test success.

## Evidence format

For each implementation gate, record the source revision, image/package versions, date, environment, steps, observed outcome, and remaining limitations. Use logs or screenshots only when they substantiate the result, and exclude secrets and private message content.

## Functional and authorization scenarios

| Area | Required evidence |
| --- | --- |
| Owner setup | Host-obtained setup token creates one owner; expired/reused tokens and unauthorized setup fail |
| Accounts | Owner/moderator login, logout, recovery, and revoked sessions behave consistently in Web and Electron |
| JWT/JWKS | Valid token accepted; wrong issuer/audience/algorithm, expiry, unknown key rejected; rotation and cache behavior tested |
| Guests | Nickname admission creates stable per-server identity; reopening preserves it; clearing client data cannot recover it by nickname |
| Invitations | Closed mode rejects uninvited admission; concurrent redemption respects use limits; expiry/revocation prevent new admission |
| Open mode | Address and nickname admit a guest; switching to closed mode changes new-admission behavior |
| Roles | Guests cannot administer; moderators cannot change installation ownership or assign privileged roles |
| Moderation | Kick, ban, message deletion, and forced mute apply to active WebSocket/media connections and reconnect attempts |
| Media grants | Removed users cannot regain publication by replaying an already-issued grant; actual self-hosted behavior is verified |
| Messages | Persistence precedes acknowledgement; retries do not duplicate; own-message edit/delete and moderator deletion enforced |
| History | Existing history visible to admitted users; pagination remains correct while new messages arrive; retention removes eligible bodies |
| Voice | Mute/deafen, speaking state, supported device selection, participant volume, foreground push-to-talk, and switching channels work |
| Saved servers | Identities remain isolated; switching cannot leave two active voice conversations |
| Languages | EN/PL parity, locale persistence, translated errors, keyboard labels, and landing locale routes verified |

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

| Surface | Required checks |
| --- | --- |
| Desktop Web: Chrome/Edge, Firefox, Safari | Joining, accounts, chat, foreground voice, permissions, reconnect, EN/PL |
| iPhone/iPad Safari | Responsive layouts, touch controls, keyboard behavior, foreground chat/voice, microphone permissions |
| Android phone/tablet Chrome | Same mobile scenarios, including real microphone and output routing behavior |
| Electron Windows | Clean install/start, per-server credentials, microphone, foreground PTT, updates, uninstall behavior |
| Electron macOS | Same desktop scenarios plus signing/notarization status and OS permission handling |

Global Electron push-to-talk and mobile background audio are separately reported capabilities. Global push-to-talk is not claimed without platform evidence; uninterrupted mobile background audio is outside the first release guarantee. Browser-specific inability to select an audio output must be surfaced rather than hidden behind a nonfunctional control.

## First private release checklist

- [ ] Stages 0–3 have evidence for all mandatory gates.
- [ ] Windows/macOS packages and required Web/device combinations have been tested.
- [ ] Core conversation has been tested with real participants, not only simulated media.
- [ ] Installation, upgrade, backup, and restore instructions match the delivered artifacts.
- [ ] EN and PL are complete for the application and landing.
- [ ] Known limits, signing status, supported versions, and performance environment are published with the private release.
- [ ] No claim of E2EE, guaranteed anonymous-ban enforcement, unlimited scalability, or guaranteed mobile background voice is made.
