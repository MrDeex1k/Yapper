import { desktopCapturer, dialog, type BrowserWindow } from 'electron';
export function installScreenPicker(window: BrowserWindow) {
  let picking = false;
  window.webContents.session.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (
        picking ||
        request.frame !== window.webContents.mainFrame ||
        request.securityOrigin !== 'yapper://app' ||
        !request.userGesture ||
        !request.videoRequested
      ) {
        callback({});
        return;
      }
      picking = true;
      void (async () => {
        try {
          const sources = (
            await desktopCapturer.getSources({
              types: ['screen', 'window'],
              thumbnailSize: { width: 0, height: 0 },
            })
          ).slice(0, 12);
          if (!sources.length || window.isDestroyed()) {
            callback({});
            return;
          }
          const choice = await dialog.showMessageBox(window, {
            type: 'question',
            message: 'Choose what to share',
            detail:
              'Only the selected screen or window will be shared. System audio is off. Showing up to 12 sources.',
            buttons: ['Cancel', ...sources.map((source, index) => `${index + 1}. ${source.name}`)],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          const source = sources[choice.response - 1];
          if (!source || window.isDestroyed() || request.frame !== window.webContents.mainFrame) {
            callback({});
            return;
          }
          callback({ video: source });
        } catch {
          callback({});
        } finally {
          picking = false;
        }
      })();
    },
    { useSystemPicker: true },
  );
}
