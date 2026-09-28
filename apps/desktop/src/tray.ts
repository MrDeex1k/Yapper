import { app, dialog, ipcMain, Menu, nativeImage, Tray, type BrowserWindow } from 'electron';
import { trustedFrame } from './security';
export function installTray(window: BrowserWindow, imageData: string) {
  const tray = new Tray(nativeImage.createFromDataURL(imageData));
  let voice = false;
  let quitting = false;
  let prompting = false;
  tray.setToolTip('Yapper');
  const show = () => {
    window.show();
    window.focus();
  };
  tray.on('click', show);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Yapper', click: show },
      {
        label: 'Quit and disconnect',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  ipcMain.handle('desktop:voice-active', (event, active: unknown) => {
    if (!trustedFrame(event, window) || typeof active !== 'boolean')
      throw new Error('Invalid voice state');
    voice = active;
    tray.setToolTip(active ? 'Yapper — voice active' : 'Yapper');
  });
  window.on('close', (event) => {
    if (quitting || !voice) return;
    event.preventDefault();
    if (prompting) return;
    prompting = true;
    void dialog
      .showMessageBox(window, {
        type: 'question',
        message: 'A voice session is active',
        detail: 'Hiding keeps the microphone and conversation active. Quit disconnects.',
        buttons: ['Keep open', 'Hide to tray', 'Quit and disconnect'],
        defaultId: 0,
        cancelId: 0,
      })
      .then((result) => {
        if (result.response === 1) window.hide();
        if (result.response === 2) {
          quitting = true;
          app.quit();
        }
      })
      .finally(() => {
        prompting = false;
      });
  });
  window.webContents.on('render-process-gone', () => {
    voice = false;
    tray.setToolTip('Yapper — disconnected');
  });
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('will-quit', () => tray.destroy());
}
