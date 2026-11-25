# Stage 8 — Rust terminal client

**Status: implemented, with platform acceptance open.** See the [verification record](evidence/stage-8-terminal.md). Deliver an interactive Rust/Ratatui client for macOS, Linux, and Windows. Work against the current Yapper v1 API and a self-hosted installation. This plan covers a local compatibility probe, text chat, voice, and private build verification.

## Scope

- Connect to a trusted HTTPS community, join as a guest using a nickname and, when required, an invitation, and restore the guest identity on the same installation.
- Browse accessible channels, read recent and older plain-text messages, and send messages in writable text channels. Reconcile edits, deletions, and retention changes made elsewhere. Keep archived text channels read-only.
- Join or leave one voice channel at a time. Join muted, explicitly enable or mute the microphone, hear other participants through the system output, and show the active room and connection state.
- Provide keyboard navigation, resize handling, and English and Polish copy. Use a channel list, message history, composer, and status line. On narrower terminals, show channels and chat in separate views. Keep voice state visible in both.
- Use Web for initial setup and existing clients for administration. Start with guest admission. Keep message editing, deletion, and moderation in the existing clients. Staff sign-in, global push-to-talk, custom audio routing, and public distribution are outside the initial Stage 8 scope.

## Protocol and platform decisions

- **Connection and storage.** Follow GPUI's per-origin guest session flow. Canonicalize the full scheme, host, and port, reject redirects and untrusted TLS, and allow HTTP loopback only in development builds. Use the server-issued guest cookie for HTTP and preserve the exact installation Origin for mutations and event upgrades. Use a terminal-specific credential namespace with macOS Keychain, Windows Credential Manager, and Linux Secret Service as the initial candidates. Store only public settings outside the vault. If the vault is locked or unavailable, surface the problem and explicitly offer an in-memory session. Keep invitation codes, cookies, and grants out of command arguments, shell history, terminal output, and logs.
- **Chat.** Read `GET /api/v1/state`, admit through `POST /api/v1/guests`, and use `GET /api/v1/me` for catalog and identity. Load the timeline and reconcile the revision feed after `ready`, message events, and reconnect. Acquire a fresh ticket for each application event connection. Apply edits and tombstones even though the terminal client only sends new messages. Retry an uncertain send with the same UUID and body. Ignore stale responses when the active channel or session changes. Render remote text as data and filter terminal control sequences.
- **Voice.** Start the probe with the LiveKit Rust SDK and system input/output path used by GPUI. Try native bearer signaling for upgrades and validation through Go, as supported by the current server. If the SDK needs the origin-checked query format, evaluate GPUI's adapter before changing server behavior. Restrict signaling to the selected installation, preserve trusted TLS and grant checks, and reuse the production microphone publication rule in [yapper-voice-policy](../crates/voice-policy/Cargo.toml). Serialize room connections and submit the specific media identity on leave, exit, or room replacement. Follow the existing eligible-resume contract if automatic recovery is included. Require explicit unmute after a fresh grant.
- **Terminal lifecycle.** Start with Ratatui and Crossterm. Restore raw mode, cursor state, and the alternate screen on normal exit, interrupt, and recoverable terminal errors. Exercise panic restoration and noninteractive invocation separately. Keep HTTP and media work off the input and rendering loop.

Ratatui's lifecycle was checked through Context7 against upstream documentation. Context7 returned current LiveKit docs instead of the GPUI pin, so the existing GPUI implementation and lockfile are the starting reference (`livekit 0.12.0`, `webrtc-sys 0.3.55`). The client uses the pinned SDK and its native WebRTC archives. Physical microphone permission behavior remains part of platform acceptance. See the [Ratatui terminal lifecycle source](https://github.com/ratatui/ratatui/blob/main/ratatui/src/init.rs) and [GPUI build instructions](../apps/desktop-gpui/README.md).

## Work sequence

### 1. Compatibility probe

Start with macOS arm64, Linux x64 GNU, and Windows x64 MSVC as candidate targets. Record the exact OS, terminal, compiler, audio backend, vault, SDK, native WebRTC archive and checksum for each. Prove normal and unavailable vault behavior, terminal restoration, and muted signaling followed by physical two-way audio on each OS.

**Exit check.** A clean build joins through Go and speaks to a Web peer on all three hosts. Record platform limits before selecting the dependency pins.

### 2. Session and text

Add the `apps/terminal` app with a committed Cargo lockfile, connection and invitation prompts, session restore, channel browser, timeline, composer, retry, and event recovery. Reuse GPUI transport and wire behavior where practical and extract shared code only for verified common behavior.

**Exit check.** A terminal guest and a Web guest exchange messages on a disposable installation. Reconnect and relaunch preserve identity and converge on the same history without duplicate sends.

### 3. Voice lifecycle

Add room selection, microphone controls, visible call state, deterministic leave and cleanup. Exercise permission refusal, missing devices, network loss, switching and moderation applied from another client.

**Exit check.** Real audio works in both directions on each supported target. Leave, switching, and graceful exit release capture and close the old room. Server revocation and forced mute take effect.

### 4. Private build and acceptance

Run Cargo formatting, Clippy and tests from the pinned checkout. Verify a clean install on each target, terminal behavior, EN/PL parity, and a trusted HTTPS installation. Document the exact build, artifact and checksum, prerequisites, and known limits.

**Exit check.** Every supported target passes the [terminal acceptance matrix](validation.md#terminal-client-acceptance) with recorded evidence.

Keep compatibility outcomes and acceptance runs in a Stage 8 evidence record linked from [Validation](validation.md#terminal-client-acceptance). The initial implementation assumes the existing server contract and deployment. If a compatibility blocker requires a server change, document the reason and verify existing Web, GPUI, and native mobile/macOS clients against it. Stage 5 remains deferred, and outstanding Stage 6 and 7 device and packaging checks retain their own acceptance records.
