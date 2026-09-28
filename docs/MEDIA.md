# Media deployment and verification

## Local OrbStack

Generate independent `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` values in `.env` (secret: `openssl rand -hex 32`). Run `docker compose --profile media up -d media`. Local signaling is http://127.0.0.1:17880, ICE TCP is 17881 and UDP is 17882. `python3 scripts/test-media.py` joins two ephemeral participants and checks reception of an Opus RTP packet. Test rooms expire after participants leave.

The local configuration advertises its container address, reachable from this host through OrbStack. Other Docker runtimes may need an explicit reachable `rtc.node_ip`. HTTPS pages cannot connect to insecure `ws://` signaling; use WSS in production. The client-facing URL and backend control URL are separate settings.

## Internet deployment acceptance

1. Replace the local LiveKit YAML with deployment-specific public ICE addresses and TLS signaling behind a WebSocket-capable proxy.
2. Open the configured media TCP/UDP ports. Do not expose LiveKit API secrets or PostgreSQL.
3. Configure LiveKit embedded TURN or a separately managed TURN service, with valid certificates and credentials. A TLS-only reverse proxy does not relay arbitrary UDP media.
4. Join from two independent networks (for example fixed broadband and cellular). Verify audio in both directions, mute, reconnect and permission revocation.
5. Repeat with relay-only ICE configuration in the client test harness; inspect the selected ICE pair to prove relay usage. Merely seeing a TURN URL is not evidence that TURN worked.
6. Record browser/OS, network conditions, codec, packet loss, delay, duration and SFU resources.

WAN and TURN acceptance are pending until public networking/certificates are configured. Local RTP delivery is not a substitute for those checks. Swift/Android SDK compatibility and Rust native audio remain later platform acceptance work.

## Failure behavior

Text chat remains usable if media is unavailable. Joining voice must report a clear error and leave the microphone off. Revocation must remove active SFU participants as well as deny new grants. Media grants are short-lived and scoped to one room and identity; clients never receive the server API secret.

## Room admission and revocation

`POST /api/v1/channels/{id}/voice` requires a current authorized application session and a voice channel. It returns a one-minute room-specific join token that initially permits only microphone publication. `GET .../participants` queries current SFU participants. `DELETE .../voice` revokes the user's grant and removes their participant.

Membership removal and logout revoke grants and request immediate SFU removal. A bounded reconciliation loop checks active SFU participants against current database sessions and membership every five seconds, including after a restart. If SFU control is unavailable the API reports disconnect pending and the loop retries. This is bounded eventual revocation, not a claim of instantaneous enforcement during a network partition. A previously issued token can still be presented during its validity; the reconciler removes unauthorized rejoins. Self-hosted token refresh behavior must be included in WAN/security acceptance.

## Browser lifecycle

The room SDK handles transient reconnection; the UI distinguishes connecting, reconnecting and disconnected states. A final disconnect clears the participant/speaker list. Leaving or unmounting aborts pending admission and disconnects tracks; a delayed join is checked before and after enabling capture. Device-change events refresh input/output selectors; capture failures surface in the room instead of silently leaving an inactive microphone. Push-to-talk uses V only outside typing controls and releases on window blur.

Slow text-notification subscribers are disconnected rather than growing an unbounded queue. Application sessions are cleaned in bounded batches after expiry; SFU reconciliation removes participants whose sessions have expired.

## Screen sharing (F05-E03)

Screen publication is explicit and can be disabled by the host with `ALLOW_SCREEN_SHARE=false`. Join grants whitelist microphone and, when enabled, screen video only. Screen/system audio is intentionally disabled in this candidate. Browser capture uses the browser's picker; Electron uses an available system picker or a native source-selection dialog (up to 12 enumerated sources), with Cancel as default. Denial/cancellation returns a visible error and does not start sharing.

Client profiles request 480p/10 fps/500 kbps or 720p/15 fps/1.5 Mbps. These are capture/encoder preferences, not a server transcoding guarantee or protection against malicious senders. The bundled SFU limits a room to 16 participants and each subscriber to four video and 16 audio subscriptions; operators can edit the SFU configuration for measured hardware capacity.

`MAX_SCREEN_SHARES` defaults to two per room. The five-second reconciliation cycle removes publishers exceeding the screen count, using join order with identity as tie-breaker, and rejects duplicate/unsupported track sources. This is eventual enforcement: simultaneous publications can briefly exceed the count and SFU outages delay enforcement. Exceeding policy disconnects the participant, including voice. Existing calls must reconnect after host policy changes. Real Windows/X11/Wayland screen selection remains part of platform acceptance.

Local Chrome check (2026-09-28): a synthetic-microphone voice participant started sharing the Yapper browser tab; the UI showed a live local screen tile and Stop sharing. Stopping sharing and leaving voice were exercised. This is a local browser smoke, not remote video quality or Windows/Linux picker acceptance.
