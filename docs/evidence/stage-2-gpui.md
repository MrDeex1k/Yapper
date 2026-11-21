# Stage 2 GPUI prototype evidence

The prototype is in [apps/desktop-gpui](../../apps/desktop-gpui/README.md). It uses Rust 1.100.0, GPUI 0.2.2, GPUI Component 0.5.1, LiveKit 0.12.0 and keyring 4.2.0. Windows and Linux are the build targets.

- The UI uses the Yapper desktop palette and workspace layout. The localized scope covers server selection, guest admission, voice channels, remote participants, microphone mute and disconnect.
- The native HTTP client scopes credentials to the selected origin and rejects redirects. It stores guest credentials in Windows Credential Manager or Linux Secret Service when available.
- The Rust LiveKit SDK sends a grant in an authorization header. The [transport adapter](../../apps/desktop-gpui/src/signaling.rs) converts it to the existing Go media-gate request, preserves the SDK's TLS transport, and supplies the matching `Origin`. The app restricts the returned media URL to the same server. Linux and Windows audio use LiveKit PlatformAudio.
- Context7 provided GPUI and LiveKit guidance. Where Context7 lacked the transport registration details, the pinned `livekit`, `livekit-signaling` and `livekit-net` crate sources established the adapter contract.

## Verified on Ubuntu 26.04 ARM64

An OrbStack Linux container used Clang 21 to build the pinned dependencies. `cargo fmt --check`, `cargo check --locked`, `cargo clippy --locked --all-targets -- -D warnings`, `cargo test --locked`, and `cargo build --locked` passed. The three unit tests cover trusted origins and both forms of signaling request. The repository `pnpm check` also passed. Cargo emitted a future-compiler compatibility warning for the transitive `proc-macro-error2 2.0.1` dependency.

- The Linux binary opened a 1200 × 800 Yapper window under Xvfb (X11).
- The opt-in smoke test against a fresh Stage 2 Compose project passed native guest admission, the media grant, the WebSocket upgrade through Go to LiveKit 1.13.11, and clean release.
- With a disposable GNOME Keyring and D-Bus session, the same test passed and a Secret Service query confirmed the per-origin credential was stored. The smoke test restored the same nickname from that credential.

## HTTPS signaling follow-up

The prior Linux smoke used loopback HTTP. Preparing the LAN test exposed a missing TLS feature in the SDK's native WebSocket transport. The GPUI crate now enables `rustls-tls-native-roots` on the locked `tokio-tungstenite` 0.29.0 dependency.

On 2026-11-21, Ubuntu 26.04 ARM64 passed `cargo check`, `cargo fmt --check`, `cargo clippy --locked --all-targets -- -D warnings`, and the three default unit tests. The opt-in signaling smoke passed against a fresh Stage 2 Compose installation over HTTPS with a test CA supplied through `SSL_CERT_FILE`. It exercised guest admission, secure signaling through Go, LiveKit connection, and clean release. Brave also joined the same installation with its microphone muted.

## Verified on Windows x64

PC-Jakub built the updated prototype on 2026-11-21 with Rust 1.100.0, Visual Studio C++ Build Tools, Windows SDK 10.0.26100 and LLVM 23.1.6. The locked `x86_64-pc-windows-msvc` build used `-C target-feature=+crt-static` to match the pinned WebRTC library.

The GUI joined Lounge via the LAN HTTPS test server using a process-scoped CA. It restored the saved guest after restart and rejoined Lounge. LiveKit reported both Windows GPUI and Brave on macOS active in the same room. The maintainer tested both physical microphones and confirmed audible speech in both directions.

## Linux X11 visual review

On 2026-11-21, the current locked build rendered the server picker, guest entry, and channel workspace under Xvfb on Ubuntu 26.04 ARM64. The workspace text and controls remained visible at 1200 × 800 and 800 × 600. The initial capture was blank in the bare Xvfb session. Focusing and resizing the window produced rendered frames for inspection.

The baseline visual check showed the earlier mint accent and voice-only workspace. Stage 2 uses X11 for Linux visual review and the Windows GPUI to macOS Web pair for manual call acceptance. Linux physical-device checks are covered in Stage 4.

## Web appearance alignment

The visual pass aligns the server picker, guest entry, language menu, channel navigation, profile and voice dock with the current Web reference. It embeds the same brand image and Lucide glyphs, applies the graphite palette, and moves the compact layout into a collapsible channel panel below 701 pixels. The native app also provides its server-change action and a notice when credential storage is unavailable.

On Ubuntu 26.04 ARM64, the Xvfb walkthrough compared the Web and GPUI entry and workspace at 1200 × 800 and exercised the GPUI compact layout at 640 × 600. It checked language switching, channel selection, and the connected voice dock with a virtual audio sink and the microphone muted. `cargo fmt --check`, `cargo clippy --locked --all-targets --all-features -- -D warnings`, the three unit tests, and the locked build passed. The scoped pedantic review found no warnings in the changed modules. A locked Windows x64 build displayed the Polish workspace, graphite theme, and new sidebar on PC-Jakub.

## Text channels and push to talk

The native workspace opens the first active text channel after admission or guest restoration. It refreshes the newest 50 messages from the Stage 2 timeline endpoint every two seconds while the channel is selected. Sending uses a request ID so retrying the same draft after a failed response can reuse the original server operation. The text view remains visible while joined to voice. Chat pagination, editing, and moderation are outside this desktop slice.

In voice, the **Push to talk** switch replaces the manual microphone button with a Space hint. The keyboard handling is scoped to the active window and yields to the message field. The client clears the transmit request on release, window deactivation, reconnect, and leave. LiveKit publishes the track muted before reading the latest transmit request for the first time.

On Ubuntu 26.04 ARM64, `cargo fmt --check`, `cargo check`, `cargo clippy --locked --all-targets --all-features -- -D warnings`, the three default unit tests, and the locked build passed. Xvfb displayed the empty text channel and a message posted from macOS. The 1200 × 800 and 640 × 600 captures showed the chat alongside Lounge with the push-to-talk switch enabled and the microphone muted. Linux verification covered appearance with a virtual audio sink.

PC-Jakub built the same source with Rust 1.100.0 and the locked Windows x64 target. The native app restored the guest session, loaded the macOS fixture in `#general`, sent a message using Enter, and displayed it in the timeline. The Stage 2 API confirmed the posted message. The Polish workspace kept the channel open while joined to Lounge and showed the Space hint with the manual microphone button hidden after the switch was enabled.

The voice dock follow-up groups channel status and icon actions in the first desktop row. A labeled switch keeps push to talk discoverable in the second row, and an outlined key hint appears when enabled. The compact layout fits these controls in one row. Xvfb showed the desktop dock in both modes at 1200 × 800, and the compact push-to-talk dock at 640 × 600 with chat visible. The locked build, format check, standard and pedantic Clippy with warnings denied, and the three default tests passed.

PC-Jakub compiled the revised dock and verified both modes in the Polish workspace. Manual mode showed the microphone and leave icons next to the channel status. Enabling push to talk hid the microphone icon and showed the **Spacja** shortcut. The final Windows capture showed Lounge joined, the microphone muted, and the existing `#general` history visible.

The maintainer manually tested foreground push to talk with the physical microphone on PC-Jakub and confirmed that the Space shortcut worked as expected.
