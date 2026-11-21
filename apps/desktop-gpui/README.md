# Yapper GPUI prototype

This client validates the native Windows and Linux path for Stage 2. It accepts a server address, admits or restores a guest, and lists text and voice channels. The text view fetches the most recent 50 messages for the selected channel and supports sending. The voice connection uses LiveKit with the host's default input and output. The microphone starts muted. The interface is available in English and Polish. The current Web UI is the visual reference.

The app embeds the Web wordmark image, [Inter 4.1](https://github.com/rsms/inter/releases/tag/v4.1), and the Lucide 1.77.0 glyphs used by its Web reference. The font and icon licenses are bundled in [assets/fonts](assets/fonts) and [assets/icons](assets/icons).

## Build and run

Install the toolchain with rustup and run these commands from this directory.

```sh
cargo build --locked
cargo run --locked
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
```

- **Windows:** use the MSVC toolchain with Visual Studio C++ Build Tools, a Windows SDK, and LLVM with `clang-cl`. Set `$env:RUSTFLAGS = "-C target-feature=+crt-static"` in the build shell, then run `cargo build --locked --target x86_64-pc-windows-msvc`. The static C runtime matches the pinned LiveKit WebRTC library. Use Windows Credential Manager for guest sessions.
- **Linux:** use a desktop session with X11 or Wayland, a Vulkan driver, and Secret Service for saved guest sessions. Install Clang 21, pkg-config, the C/C++ build tools, and headers for GLib, fontconfig, FreeType, xkbcommon, Wayland, XCB, Vulkan, ALSA, PulseAudio, udev, and libjpeg. On Ubuntu 26.04 set `CC=clang-21` and `CXX=clang++-21`. Running the checks needs access to the published LiveKit WebRTC artifact.

Use a trusted HTTPS installation. Debug builds also allow HTTP on a loopback address for disposable local tests. Enter a nickname and an invitation when the server requires one. Select a text channel to read messages or send one with Enter. Archived channels are read-only.

Join a voice channel and use **Enable microphone** or turn on **Push to talk**. In push-to-talk mode, hold Space with the window active and focus outside the message field. Releasing Space or switching to another window mutes the microphone. Leave voice before changing servers. When the system credential store is unavailable, the session stays in memory for the current run.

## Integration smoke test

Set `YAPPER_GPUI_TEST_SERVER` and `YAPPER_GPUI_TEST_INVITATION` in a local, private environment for a disposable Stage 2 server. Run the ignored native smoke case with the pinned toolchain.

```sh
cargo test --locked joins_through_yapper_signaling_gate -- --ignored
```

This exercises guest admission, credential restoration when a store is available, the grant, the WebSocket upgrade through Go, the native SDK room connection, and release of the grant. Verify microphone capture and audible playback separately on physical Windows and Linux setups.

The lockfile uses `libc 0.2.189` and `mio 1.2.4` because the GPUI 0.2.2 dependency chain includes an older `xattr` that requires the Linux `ENOATTR` alias removed in libc 0.2.190. Keep the lockfile when building.
