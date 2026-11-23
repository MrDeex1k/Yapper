# Stage 4 Blaze evaluation

Yapper GPUI targets Windows x64 MSVC and Linux. The Windows build links the pinned LiveKit WebRTC library with `-C target-feature=+crt-static`. The Windows installer and Linux package each need a release executable. The [GPUI build instructions](../../apps/desktop-gpui/README.md) describe the pinned Cargo workflow.

## Published release

The [Blaze v0.20261122.0 release](https://github.com/indexable-inc/blaze/releases/tag/v0.20261122.0) provides executables for Apple Silicon and Linux ARM64 and x86-64. The release archives for Apple Silicon and Linux ARM64 matched the published SHA-256 digests. The Linux ARM64 executable ran in the Ubuntu GPUI build environment after a disposable container profile enabled the three `io_uring` syscalls that Blaze needs. The default container profile returned `EPERM` before argument parsing.

- `blaze build` reported that the command was unavailable. `blaze export` reported that native executable export was unimplemented.
- `blaze check --locked` rejected the flag. `blaze check` on the GPUI sources stopped while opening Blaze's pinned toolchain manifest. The release binary expects `187c11dc57908faed50beacf02d982fbd188ecb17f2e0c8b5c7571b4393d5793` in its toolchain shelf.
- The `toolchain_cut` utility from the release tag built with its pinned Rust nightly. A cut for Apple Silicon, Linux ARM64, Linux x86-64, and the WASI macro target produced manifest `1d62497fe3744e8fb5e571597963f71549f9621f4fbffb1c33925f73403a8175`. The published binary cannot use that manifest in place of its pin. The upstream [toolchain design](https://github.com/indexable-inc/blaze/blob/v0.20261122.0/docs/v2/plan/design/toolchain.md) describes the content-addressed shelf format.

The published release's [command reference](https://github.com/indexable-inc/blaze/blob/v0.20261122.0/docs/usage.md) describes the current limits of `run`, `test`, and executable export.

A separate build of the tagged Blaze sources with the reproduced manifest got past toolchain loading. The Linux ARM64 GPUI check then stopped in Blaze's dependency fetch driver with `the fetch machine did not settle a unit within its steps (rule 18)`.

## Native dependency lock

[Blaze v0.20261029.7](https://github.com/indexable-inc/blaze/releases/tag/v0.20261029.7) generated a lock for three LiveKit archives using `blaze lock --fetches`. Yapper uses this lock for a checksum-verified WebRTC SDK cache, which can feed a normal Cargo build through `LK_CUSTOM_WEBRTC`. The [GPUI build instructions](../../apps/desktop-gpui/README.md#prepare-the-pinned-webrtc-sdk) describe the workflow.

ARM64 GPUI `blaze check`, `blaze test`, and `blaze build` reached `webrtc-sys` with the pinned archive. They subsequently failed because the proc-macro build graph for `wasm32-wasip1` lacked `const-random-macro 0.1.16`. A targeted host-macro override in a disposable checkout reproduced the check failure. This blocks adoption of the Blaze compiler for GPUI.

## Verification

- The repository's lock refresh command produced all three archive pins with Blaze v0.20261029.7. The generated lock matched the repository copy byte for byte. The launcher rejected v0.20261122.0.
- The preparation helper verified the actual release archives and unpacked the expected libraries for Windows x64, Linux x64, and Linux ARM64. Second runs returned the cached paths. An archive with an incorrect SHA-256 was rejected.
- On Ubuntu 26.04 ARM64, the pinned Rust 1.100.0 baseline passed `cargo check --locked --offline` and all three ordinary Cargo tests. The server-backed smoke test stayed ignored.
- An offline Cargo release build on Ubuntu 26.04 ARM64 used the prepared WebRTC SDK and produced an AArch64 ELF executable. Native linking was verified on Linux ARM64. Linking and runtime acceptance on Windows x64 and Linux x64 remain unverified.
