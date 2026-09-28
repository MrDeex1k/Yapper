# Desktop development and verification

The Windows/Linux client packages the same React build as the browser. It serves bundled assets at `yapper://app`, with sandboxing, context isolation and Node integration disabled in the renderer. Only a typed, origin-checked preload bridge is exposed. External HTTPS links require a native confirmation. Navigation, popups and webviews are blocked. The API accepts the exact desktop origin and still requires bearer authentication on protected routes.

Run `pnpm --filter @yapper/desktop dev`, `pnpm --filter @yapper/desktop smoke` or `pnpm --filter @yapper/desktop dist`. Packaging produces an unsigned Windows portable executable or Linux AppImage/tar.gz. No installer or auto-update service is implied. The macOS development smoke is not a shipped macOS client; Swift remains planned for F06.

The desktop CI matrix runs a renderer startup smoke and packages on Windows/Linux. Linux CI uses Xvfb and disables the Chromium sandbox only for the CI smoke process, never in the shipped application. Physical microphone, tray, shortcut and Wayland acceptance must be performed separately on the intended desktop environments.

Sources: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [custom protocols](https://www.electronjs.org/docs/latest/api/protocol).

## Voice integration

Global hold-to-talk is opt-in during a joined conversation: choose F8, F9 or F10. Registration detects reserved accelerators; a native input hook observes only the selected key for transmission and does not store or forward keystrokes. Release, screen lock, suspend and a 30-second watchdog mute the microphone. Windows/X11 are implementation targets; physical acceptance is pending. Wayland and the macOS development shell deliberately fall back to focused V hold-to-talk, because the global-shortcut activation API alone cannot reliably observe release. Missing native libraries return a visible fallback.

Closing an active voice window asks whether to keep it open, hide to tray (voice stays active), or quit and disconnect. Switching to a text channel keeps the voice panel mounted; its controls remain reachable in the sidebar. Deafen blocks transmission from both PTT controls. Use one PTT mode at a time.

Verification: macOS renderer smoke passed. Windows/Linux startup/package jobs were launched in PR #16; Linux found a scoped-package executable-name bug, fixed with explicit `executableName: yapper`. Global key press/release, tray interaction and microphones still need physical Windows/X11/Wayland pilot results. Sources: [Electron global shortcuts](https://www.electronjs.org/docs/latest/api/global-shortcut), [uiohook-napi](https://github.com/SnosMe/uiohook-napi).
