# Yapper for phones and tablets

Android uses Jetpack Compose. iOS uses SwiftUI and links the shared Kotlin Multiplatform framework from `shared`. The shared module handles the server contract, per-origin sessions, chat and voice admission. Each platform supplies secure storage and its LiveKit audio adapter. Emulator and simulator runs cover chat, tablet layouts, and muted joins. Physical two-way audio, background calling, and signed distribution still need acceptance evidence.

## Build on a Mac

Use a JDK supported by Gradle 9.6.0 and Android Gradle Plugin 9.2.1, Android SDK 36, and Xcode. The recorded builds used JDK 25.0.4 and Xcode 27.2. Set `ANDROID_HOME` or add an untracked `local.properties` with the SDK path. The checked-in Gradle wrapper verifies its distribution checksum. Xcode resolves the exact LiveKit Swift package and builds the shared static framework during the app build.

From this directory:

```sh
./gradlew :android:assembleDebug :shared:iosSimulatorArm64Test
xcodebuild -project ios/Yapper.xcodeproj -scheme Yapper -configuration Debug -sdk iphonesimulator build
```

The APK is at `android/build/outputs/apk/debug/android-debug.apk`. Select an iPhone or iPad simulator or a signed device target in Xcode to run the Apple client. The Android minimum SDK is 26 and the iOS deployment target is 17.0. The Apple build targets arm64 devices and simulators.

The workspace fills the available window. At 760 dp on Android or 760 points on iOS and iPadOS, the sidebar scales with the window and chat fills the remaining width. Narrower windows use the same channel drawer as phones.

## Connect to a server

Enter the community's trusted HTTPS origin. The server needs the native bearer signaling support in this revision. Existing browser and GPUI connections continue to use the origin-checked signaling route. Initial installation setup is available in Web.

Debug builds also accept HTTP on loopback for an isolated smoke server. To reach a loopback server from the Android emulator, forward its port with `adb reverse tcp:<port> tcp:<port>` and use the same `127.0.0.1` origin as the server. Voice testing also requires reachable LiveKit ICE ports. Release builds accept trusted HTTPS only. Use a disposable database and guest accounts for development tests.

See the [mobile plan](../../docs/stage-6-mobile-plan.md), [verification record](../../docs/evidence/stage-6-mobile.md), and [server contract](../../docs/contracts.md).
