# Yapper Terminal

Yapper Terminal is the Stage 8 keyboard client for guest chat and voice. Enter a Yapper community's HTTPS origin, then enter a nickname and an invitation code if the community requires one. Reenter the same origin to restore a remembered guest. Use Web to set up or administer a community.

## Build and run

Install Rustup and the build tools for the target. From this directory:

```sh
cargo build --locked
cargo run --locked -- --lang en
cargo fmt --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked
```

Pass `--lang pl` to start in Polish. You can pass the server origin as the last argument to prefill it. Enter invitation codes inside the masked form.

- **macOS arm64.** Install Xcode or the Xcode Command Line Tools. The CLI embeds a microphone usage description and loads the Objective-C categories required by WebRTC. If macOS asks for microphone access, grant it to the terminal or application it identifies. Local rebuilds can prompt for Keychain access again.
- **Linux GNU.** Use a compiler compatible with the pinned WebRTC archive, with C/C++ tooling, pkg-config, ALSA and PulseAudio development libraries. The arm64 build was tested on Ubuntu 26.04 with Clang 21. Secret Service needs a running session bus and unlocked vault. Voice uses the system input and output.
- **Windows x64.** Use the MSVC toolchain with Visual Studio C++ Build Tools, a Windows SDK, and LLVM with `clang-cl`. Build from this directory so Cargo loads the static CRT configuration required by the WebRTC library. Windows runtime acceptance is pending.

Cargo uses the WebRTC archive selected by the locked LiveKit SDK. For a checksum-verified Linux or Windows build, use the [GPUI archive preparation procedure](../desktop-gpui/README.md#prepare-the-pinned-webrtc-sdk) for your target and set `LK_CUSTOM_WEBRTC` to the resulting SDK directory before building this crate. For macOS arm64, the [upstream release](https://github.com/livekit/rust-sdks/releases/tag/webrtc-a545de4) publishes `webrtc-mac-arm64-release.zip` with SHA-256 `153a1f1a268b812b4a501deda6505037f29481691efec52be817f560ff09e206`. Verify it before extracting and point `LK_CUSTOM_WEBRTC` at the extracted `mac-arm64-release` directory.

For a local installation, run `cargo install --locked --path .` from this directory. Release builds require HTTPS with a trusted certificate. Debug builds also accept loopback HTTP for disposable tests.

## Keyboard controls

| Key | Action |
| --- | --- |
| F1 | Switch English and Polish |
| Tab, Esc | Switch between channels and chat, or return to channels |
| ↑, ↓, Enter | Move in the channel list and open a text channel or join voice |
| Enter in chat | Send or retry the draft using the original request ID |
| Ctrl+U in chat | Clear the draft |
| PgUp, PgDn, F6 | Scroll history or load an older page |
| F5, F7 | Toggle the microphone or leave voice |
| F4, F8 | Return to the server prompt or refresh the workspace |
| Ctrl+C | Exit the client and leave voice |

Voice starts muted. A reconnect or permission change requires another explicit unmute. Chat stays available while you talk. Archived text channels are read-only. If the credential store cannot be used, F3 offers a temporary guest session that lasts for the current connection.

See the [Stage 8 acceptance record](../../docs/evidence/stage-8-terminal.md) for the operating systems and scenarios exercised.
