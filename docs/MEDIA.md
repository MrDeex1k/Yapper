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
