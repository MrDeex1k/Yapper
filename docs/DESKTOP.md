# Desktop development and verification

The Windows/Linux client packages the same React build as the browser. It serves bundled assets at `yapper://app`, with sandboxing, context isolation and Node integration disabled in the renderer. Only a typed, origin-checked preload bridge is exposed. External HTTPS links require a native confirmation. Navigation, popups and webviews are blocked. The API accepts the exact desktop origin and still requires bearer authentication on protected routes.

Run `pnpm --filter @yapper/desktop dev`, `pnpm --filter @yapper/desktop smoke` or `pnpm --filter @yapper/desktop dist`. Packaging produces an unsigned Windows portable executable or Linux AppImage/tar.gz. No installer or auto-update service is implied. The macOS development smoke is not a shipped macOS client; Swift remains planned for F06.

The desktop CI matrix runs a renderer startup smoke and packages on Windows/Linux. Linux CI uses Xvfb and disables the Chromium sandbox only for the CI smoke process, never in the shipped application. Physical microphone, tray, shortcut and Wayland acceptance must be performed separately on the intended desktop environments.

Sources: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [custom protocols](https://www.electronjs.org/docs/latest/api/protocol).
