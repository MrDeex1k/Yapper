import { app, globalShortcut, ipcMain, powerMonitor, type BrowserWindow } from 'electron';
import { trustedFrame } from './security';
import type { uIOhook as NativeHook, UiohookKeyboardEvent } from 'uiohook-napi';
export function installPTT(window: BrowserWindow) {
  let hook: typeof NativeHook | undefined;
  let accelerator = '';
  let pressed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const emit = (value: boolean) => {
    if (!window.isDestroyed()) window.webContents.send('desktop:ptt', value);
  };
  const release = () => {
    pressed = false;
    clearTimeout(timer);
    emit(false);
  };
  const stop = () => {
    release();
    if (accelerator) globalShortcut.unregister(accelerator);
    accelerator = '';
    hook?.stop();
    hook?.removeAllListeners();
    hook = undefined;
  };
  ipcMain.handle('desktop:ptt-configure', async (event, key: unknown) => {
    if (!trustedFrame(event, window)) throw new Error('Untrusted sender');
    stop();
    if (key === null) return { enabled: false, reason: 'Global push-to-talk disabled' };
    if (key !== 'F8' && key !== 'F9' && key !== 'F10') throw new Error('Unsupported key');
    if (
      process.platform === 'darwin' ||
      process.env.XDG_SESSION_TYPE === 'wayland' ||
      process.env.WAYLAND_DISPLAY
    )
      return {
        enabled: false,
        reason: 'Global hold-to-talk unavailable here. Use focused V push-to-talk.',
      };
    try {
      if (!globalShortcut.register(key, () => {}))
        return { enabled: false, reason: 'Shortcut is already reserved. Choose another key.' };
      accelerator = key;
      const native = await import('uiohook-napi');
      hook = native.uIOhook;
      const down = (e: UiohookKeyboardEvent) => {
        if (e.keycode !== native.UiohookKey[key] || pressed) return;
        pressed = true;
        emit(true);
        timer = setTimeout(release, 30000);
      };
      const up = (e: UiohookKeyboardEvent) => {
        if (e.keycode === native.UiohookKey[key]) release();
      };
      hook.on('keydown', down);
      hook.on('keyup', up);
      hook.start();
      return { enabled: true, reason: `Hold ${key} to talk globally (30 second safety timeout).` };
    } catch {
      stop();
      return { enabled: false, reason: 'Native input unavailable. Use focused V push-to-talk.' };
    }
  });
  powerMonitor.on('suspend', release);
  powerMonitor.on('lock-screen', release);
  window.webContents.on('render-process-gone', stop);
  window.webContents.on('did-start-navigation', stop);
  app.on('will-quit', stop);
}
