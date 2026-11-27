# Yapper for macOS

The first desktop target is macOS 26 or later on Apple Silicon. Open `apps/mobile/ios/Yapper.xcodeproj` and select **YapperMac** and **My Mac**. This target builds with Xcode and the pinned LiveKit Swift package. It can be built without Gradle or the Android SDK. The **Yapper** target in the same project builds the iPhone and iPad application and links the Kotlin framework.

From the repository root, build a local development copy with:

```sh
xcodebuild -project apps/mobile/ios/Yapper.xcodeproj -scheme YapperMac \
  -configuration Debug -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath .tmp/mac-build CODE_SIGN_IDENTITY=- build
open .tmp/mac-build/Build/Products/Debug/Yapper.app
```

The sandbox permits outbound connections and the local socket bindings used by WebRTC ICE. macOS requests microphone permission when enabling capture. Enable **Push to talk** in **Audio settings**. Space activates foreground push-to-talk while the workspace has keyboard focus. Typing in chat and switching away release the shortcut.

Message text size is selectable in **Settings** and persists across launches. Local Debug and ad-hoc Release builds have been exercised on Apple Silicon. Clean-machine installation, notarization, and physical two-way audio remain open. See the [Stage 7 verification record](../../docs/evidence/stage-7-macos.md).

## Moving from Web

Select the same trusted HTTPS community used in Web. Staff sign in with their existing account. A browser guest joins with a new native guest identity and may need another invitation. The Mac stores its own per-server credentials in Keychain. Existing channel history lives on the server and appears after admission. The browser guest keeps ownership of its messages. Initial server setup remains available in Web. Debug builds additionally accept HTTP on loopback.

## Local chat smoke test

Use an existing disposable, open-admission loopback server with a writable default text channel. The smoke test admits two temporary guests, sends a message, observes its edit and deletion on the other client, and reconnects one guest with the same credential. It also checks origin normalization and message limits.

```sh
mkdir -p .tmp
swiftc -parse-as-library apps/macos/Yapper/{CommunityClient,CommunityTransport,CommunityTypes}.swift \
  apps/macos/Tests/CommunitySmoke.swift -o .tmp/mac-community-smoke
.tmp/mac-community-smoke http://127.0.0.1:8090
```
