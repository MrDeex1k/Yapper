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

## Remaining acceptance

Run the prototype on Windows x64 and a Linux desktop. Record the distribution, desktop session, GPU and audio backends, native credential restoration on each system, and whether each participant hears speech in both directions. The Stage 2 Brave/Electron call provides Web/Electron evidence. This prototype cannot substitute for a call on target hardware.
