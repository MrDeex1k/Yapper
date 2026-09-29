# Product specification

## Purpose and constraints

The first product is a private, self-hosted communicator for friends with dependable voice and basic text chat. Discord-like capabilities are the long-term direction, not a requirement to duplicate Discord in the first release.

Development is performed by one person with a few hours available per week. Work is sequenced by dependencies and completion gates rather than calendar estimates. The developer is familiar with the selected technologies.

One Docker Compose project represents one independent server/community. Operators initially use a Linux VPS or another server with a public address, a domain, HTTPS, and Docker Compose. Hosting behind a home router is a later deployment scenario.

The initial acceptance workload is 100 stored participant identities/accounts, 30 simultaneously online participants, and 20 simultaneous voice participants, with at most 10 in each voice channel during the test. These are test targets, not hard-coded product caps. Capacity claims must name the tested hardware, network, and workload. Hardware-only scalability is an aspiration; bandwidth, software behavior, and deployment topology also require measurement.

## Joining and identity

- The browser client is served by the community's own installation and already knows its server address.
- Electron accepts a domain or IP address with an optional port. Address entry does not imply that insecure HTTP or invalid TLS certificates are supported. Public deployment uses a trusted HTTPS endpoint.
- A participant enters a nickname without creating an account or password. The client receives a persistent identity scoped to this installation.
- Nicknames are changeable display labels, not identity proofs. Messages and permissions reference immutable server-side identifiers.
- Losing client data creates a new guest identity. Reusing the same nickname does not restore message ownership or permissions. The application explains this limitation.
- Identity transfer, guest recovery, and linking a guest to a registered account are later features. Store identity references so those features can be added without rewriting message authorship.
- Each server defaults to invitation-only admission. The owner can enable open admission, allowing anyone with the address to join.
- Invitations are links/codes with optional expiration, usage limits, and revocation. Existing membership and invitation validity are separate concepts: revoking an invitation stops new admission; removing an existing participant requires moderation.

## Roles and administration

The first release has three fixed roles:

| Role        | Capabilities                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| Owner       | Installation configuration, channel/category management, invitations, moderator assignment, and moderation |
| Moderator   | Kick, ban, force microphone mute, and delete messages                                                      |
| Participant | Read accessible history, send/edit/delete own messages, and join permitted voice channels                  |

Owners and moderators use local Better Auth accounts. Guests do not acquire privileged roles solely through a nickname or a browser preference. Moderation actions are available in the client; installation management is available in its administration area.

A one-time setup token obtained on the host authorizes creation of the first owner. The initial login uses a username and password without mandatory SMTP. Owner recovery is a host-side operation. Custom roles and per-channel permission matrices are deferred.

Bans target persistent identities. Optional IP blocking and admission/message rate limits supplement them. An anonymous participant on an open server may evade an identity ban by clearing client data; IP blocking can affect unrelated users sharing an address. Operators can switch to invitations when needed. Permanent identification of anonymous people is not promised.

## Text communication

- Categories and text channels, shared persistent history, and paginated history retrieval.
- Admitted participants can read history from before they joined.
- Participants can edit and delete their own messages; moderators and the owner can delete messages.
- Retention is installation-wide: no automatic expiry by default, with an optional maximum age in days.
- Technical default: message deletion removes the visible message body while preserving only minimal identifiers needed for references and moderation. Document how backups retain older data until backup expiry.
- Technical default: bounded plain-text messages first; attachments, rich embeds, reactions, threads, direct messages, and search are later scope unless separately approved.

## Voice communication

The first release includes voice channels, microphone/device selection where supported by the platform, per-participant volume, self-mute, deafen, speaking indicators, foreground push-to-talk, and reconnect after short network interruptions.

Global push-to-talk in Electron is a separate platform verification item. Do not advertise it as supported until tested on both Windows and macOS, including relevant OS permissions. Any device-control limitation must be represented in the UI and platform support report.

One client has at most one active voice conversation. Joining a different conversation leaves the previous one. Saved servers use independent identities. Persistent background chat connections to other servers are outside the initial release.

Mobile Web supports chat and voice while the page is open and active. Behavior after screen lock or switching apps is tested and reported, but uninterrupted background voice is not an initial acceptance requirement. Native mobile clients later target reliable background calling.

Camera, screen sharing, recording, and streaming are deferred.

## Clients and language

Code, documentation, branch names, and commit titles are English. Application UI and the Astro landing page support English and Polish from the first implementation. Localize error states, setup, moderation, accessibility labels, and installation-facing UI as well as primary screens. Technical defaults: browser-language detection, a persistent language selector, and English fallback.

The initial supported products are:

- Responsive Web on desktop and mobile, including desktop Safari, Chrome/Edge, Firefox, Safari on iOS/iPadOS, and Chrome on Android.
- Electron on Windows and macOS, sharing the React application with Web.
- An independent Astro project landing page containing product information, installation guidance, and download links. A self-hosted community opens the communicator directly.

Exact OS/browser versions and CPU architectures are pinned in the first release matrix during platform validation. Unverified combinations are not claimed as supported.

After stabilization, the roadmap is native Swift clients for iOS/iPadOS and Kotlin/Jetpack Compose clients for Android phones/tablets, then Rust/Ratatui TUI, then a dedicated Swift macOS client. GPUI and Electron Linux are not current delivery commitments. The TUI's precise voice and accessibility capabilities are scoped when that stage starts.

## Privacy and distribution

The server administrator is trusted and can technically access persisted message contents. Transport encryption is required; end-to-end encryption is not promised.

There is no automatic external telemetry or mandatory central service. Diagnostic information stays local unless an operator deliberately exports and shares it.

The first release is distributed privately to friends with manual client updates. Apple signing access is available; Windows signing access is not. Public distribution and its signing requirements are a later release gate.
