# ADR 0002: self-hosted LiveKit

Use LiveKit as a separate SFU; Go authorizes room admission with short-lived signed grants. Clients publish WebRTC tracks directly to the SFU. Application sessions are never handed to LiveKit.

LiveKit server and Go server SDK use Apache-2.0 (verify dependency licenses when redistributing). JavaScript, Swift and Android client SDKs cover the planned clients; Rust client support and native audio packaging need the F08 spike. Do not assume feature parity across SDKs.

The local spike joins two programmatic participants, publishes an Opus track and checks received RTP. This verifies the local signaling/media path, not intelligibility, acoustic echo cancellation, WAN reachability or TURN. Production acceptance still requires two external networks and a relay-only test.

Local Compose publishes LiveKit signaling and ICE ports on loopback; ICE advertises the container address reachable through OrbStack. Internet deployment needs its own public ICE address, TLS signaling, firewall and TURN configuration. The local YAML is explicitly not a production NAT recipe.

Verified locally: LiveKit server v1.13.7, Go SDK v2.18.1, protocol v1.49.0 (SDK-declared version). Two participants connected and Opus RTP reached the receiver. Protocol v1.52.1 was incompatible with the SDK SIP API and was not retained.
