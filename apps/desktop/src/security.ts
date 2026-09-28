import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
export function trustedFrame(event: IpcMainInvokeEvent, window: BrowserWindow) {
  return (
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url.startsWith('yapper://app/')
  );
}
export function secureWindow(window: BrowserWindow, version: string) {
  ipcMain.handle('desktop:version', (event) => {
    if (!trustedFrame(event, window)) throw new Error('Untrusted sender');
    return version;
  });
  ipcMain.handle('desktop:external', async (event, raw: unknown) => {
    if (!trustedFrame(event, window) || typeof raw !== 'string' || raw.length > 2048)
      throw new Error('Invalid request');
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('Only HTTPS links are supported');
    const result = await dialog.showMessageBox(window, {
      type: 'question',
      message: 'Open in your browser?',
      detail: url.href,
      buttons: ['Cancel', 'Open'],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response === 1) await shell.openExternal(url.href);
  });
  const session = window.webContents.session;
  session.setPermissionCheckHandler(
    (contents, permission, origin) =>
      contents === window.webContents &&
      origin === 'yapper://app' &&
      (permission === 'media' || permission === 'display-capture'),
  );
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const allowed =
      contents === window.webContents &&
      details.isMainFrame &&
      details.requestingUrl.startsWith('yapper://app/') &&
      (permission === 'media' || permission === 'display-capture');
    callback(allowed);
  });
  session.webRequest.onHeadersReceived({ urls: ['yapper://app/*'] }, (details, callback) =>
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' https: http: wss: ws:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
        ],
      },
    }),
  );
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
}
