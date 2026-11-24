# Stage 6 mobile client verification

## Local run on 2026-11-24

- Source was the local `main` working tree based on `80a19aa`, including the unreleased mobile clients and native signaling handler.
- Android debug APK built with Gradle 9.6.0, JDK 25.0.4, Android Gradle Plugin 9.2.1 and Android SDK 36. The Pixel 9 emulator ran Android 17.0. The iPhone 18 Pro simulator ran iOS 27.2 and the client built with Xcode 27.2. Both linked Kotlin 2.4.20. LiveKit Android 2.31.0 and Swift 2.20.0 connected to the pinned self-hosted LiveKit 1.13.11 service.
- The clients used a disposable Compose server over debug loopback, with an Android emulator port forward and a reachable local ICE endpoint. Both created distinct guest sessions and displayed each other's messages in `#general` without reloading. An edit saved on iOS appeared on Android. After reinstall and relaunch, selecting the saved server restored the original identities and the same history. Android exercised the English UI and iOS exercised the Polish UI.
- The emulator and simulator both joined `Lounge` with the microphone off. Each audio panel displayed its own participant, the other client and a remote volume control. Both displayed platform audio route choices.
- `pnpm check`, Go tests, the Android debug build, two Kotlin Multiplatform tests on the iOS simulator target, and the Xcode simulator build passed. The new Go test checks browser and native signaling credential selection. The two shared tests cover server origin normalization and history reconciliation.

The run covers simulator and emulator behavior. Physical microphones and audible two-way playback, Bluetooth, background and lock behavior, the full staff workflow, invitation-only admission, TURN/TLS, and signed private distribution still need acceptance evidence.

## Mobile review follow-up on 2026-11-24

- On the Pixel 9 emulator and iPhone 18 Pro simulator, a moderator disconnected the two test guests from `#general`. Both clients displayed the disconnect notice and disabled chat writes until the user selected Reconnect. Manual reconnection restored the same history and re-enabled editing. The Android UI was in English and the iOS UI was in Polish.
- Both updated clients joined `Lounge` with microphones muted. Each audio panel showed the other participant's name in its volume control's accessibility label.
- The Android debug build, the Xcode simulator build, nine Kotlin Multiplatform tests on the iOS simulator target, and `pnpm check` passed. The shared tests cover kick and terminal authorization handling, invitation creation followed by a failed refresh, restoring the same request ID after an uncertain send, Unicode message limits, and invalidation of a pending microphone enable. A synthetic burst of 100 message notifications during one in-flight history request produced two delta reads in total.

The microphone test exercised the shared state transition without live audio capture. Physical two-way audio, Bluetooth, and navigation with TalkBack and VoiceOver remain to be verified. Voice with the app backgrounded or the phone locked is outside the current mobile Web parity scope.

## Tablet layout on 2026-11-24

- Tested the Android 17 Pixel Tablet emulator in landscape and the iPadOS 27.2 iPad Pro 13-inch (M5) simulator in portrait against the disposable Stage 6 server. Both signed in as test guests, switched to the second text channel, exchanged messages and joined Lounge muted. Android used English and iPadOS used Polish.
- Android split screen and an iPadOS floating window both switched to the compact channel drawer while retaining the selected channel and unsent draft. The tablets returned to full screen for the final layout check. The channel list and chat occupy the whole workspace, with the composer spanning the chat pane.
- The Android debug build, the Xcode iPad simulator build and all nine shared Kotlin tests passed. Physical tablet audio, additional tablet sizes and accessibility tools remain unverified.

## Tablet review follow-up on 2026-11-24

- In a test channel with more messages than would fit on screen, both tablets displayed a new peer message immediately while at the latest end. After scrolling back and letting the list settle, another peer message left the same history rows visible. The iPad also displayed the message timestamps.
- Android retained the message edit, the invitation form input, and the same newly issued invitation code across separate activity recreations triggered by a system font-size change. The device event log confirmed the activity was recreated. The category picker scrolled to the last of 17 test destinations. Channel actions appeared disabled on Android while the session required reconnection.
- The Android debug build, the Xcode iPad simulator build and ten shared Kotlin tests passed. The new test checks channel grouping, ordering and the archive filter. Sidebar frame time and screen-reader behavior were not measured.

## Staff session and moderation regression checks

The Android debug APK and the arm64 iOS simulator application built successfully. All 14 shared Kotlin tests passed on the iOS simulator target. Four new tests cover local sign-out after a timeout or HTTP 401, overlapping catalog reads during channel archival, reloading admission settings after a remote change, and IP-block eligibility for an already banned guest. The iOS staff list now checks the requested cursor and section before displaying a response. Back navigation during a delayed page request was not exercised interactively.
