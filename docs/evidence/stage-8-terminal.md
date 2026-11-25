# Stage 8 terminal client verification

## Local verification on 2026-11-25

The client was built from the Stage 8 implementation on the branch based on `ea08e6c`. It uses Rust 1.100.0, Ratatui 0.30.2, Crossterm 0.29.0, Keyring 4.2.0, LiveKit 0.12.0, and `webrtc-sys` 0.3.55 with upstream WebRTC release `webrtc-a545de4`. The [client README](../../apps/terminal/README.md) links the platform archive pins and build commands.

| Target | Environment | Observed result |
| --- | --- | --- |
| macOS arm64 | macOS 27.2.1, Xcode 27.2, xterm-compatible PTY, login Keychain | Locked build, formatting, Clippy with warnings denied, all five unit tests, and Info.plist validation passed. The binary printed localized help and returned a failure status for noninteractive invocation. |
| Linux arm64 GNU | Ubuntu 26.04.1 LTS container, Clang 21.1.8 | Locked debug build and all five unit tests passed. The executable printed its version. |
| Linux x64 GNU and Windows x64 MSVC | Pending target hosts | Native runtime and clean-install acceptance remain open. |

The macOS PTY exercised a disposable Compose deployment through loopback HTTP. It reused the Stage 7.5 browser-test images, Go server image `2f4f72431c00`, AUTH image `4dac03212e9a`, ingress image `a98fb72c1fb7`, PostgreSQL 19 and LiveKit 1.13.11. The Go image carried no source revision label.

- **Guest sessions.** Open and invite-only admission passed. The invitation was masked. A temporary session worked, and relaunching the same binary restored the remembered Keychain guest.
- **Chat.** The terminal sent a message that appeared once in a second guest's API timeline. The terminal displayed a message from that guest and applied its subsequent edit and delete without reloading. Loading an older page exposed the oldest messages in a 55-message fixture. A loopback proxy replaced the first committed send response with HTTP 503. Retrying sent the same UUID and body and left one server message. A text channel archived by the owner immediately became read-only.
- **Voice and authorization.** The terminal joined through the Go bearer gate with the microphone muted and completed a grant-specific leave. A forced mute ended the existing room. The next join was listen-only. A kick disconnected the live event stream and the call and required explicit reconnect.
- **Terminal.** Keyboard navigation, the compact layout at 56 columns, and switching to Polish passed. Ctrl+C and SIGTERM restored the alternate screen, canonical input, and echo. SIGTERM was tested during a muted call.

The initial macOS muted voice join aborted when WebRTC looked up an Objective-C codec category. The executable now links the categories at its final link step. The subsequent joins and moderation checks above passed. The macOS build embeds a bilingual microphone usage description.

The PTY fixture used a protocol peer. Browser interoperability, a trusted HTTPS deployment, physical two-way speech and device behavior, Linux credential-store and voice integration, Windows runtime, and private clean-machine installation remain open. See the [acceptance matrix](../validation.md#terminal-client-acceptance).

## Configurable shortcuts on 2026-11-26

On macOS arm64, the Polish workspace shortcut footer aligned every key and action label at 112 columns and reflowed at 58 columns. In a PTY with an isolated home directory and loopback API fixture, the editor rejected an occupied key, saved two replacements, and loaded both after a process restart. The remapped key opened chat and sent a message. The previous server shortcut stopped working, the replacement returned to the server prompt, and restoring defaults cleared the saved overrides.

The locked build, formatting, Clippy with warnings denied, and all eight unit tests passed on macOS. All eight tests also passed in the Ubuntu arm64 container. They check preference reload, reset, conflicts, write failure, and malformed settings. Interactive Windows and Linux shortcut handling remains unverified.

The server prompt, invitation form, and shortcut editor were moved to the same footer layout. A macOS PTY verified column alignment at 58 columns, a single row at 95 columns, and all applicable invitation actions at 38 columns. Language switching and navigation back from the editor passed. The workspace remapping and restart probe, rustfmt, Clippy, and all eight unit tests passed again.

The connection footer now pairs each bracketed key with an explicit action, including Connect, Join, and the destination language. The macOS PTY rechecked both languages, the key and action pairs at 38, 58 and 95 columns, and shortcut persistence. The locked build, rustfmt, Clippy, and all eight tests passed.
