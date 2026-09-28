import { app, BrowserWindow, net, protocol } from 'electron';
import path from 'node:path';
import { installScreenPicker } from './screen';
import { installTray } from './tray';
import { trayIcon } from './icon';
import { installPTT } from './ptt';
import { secureWindow } from './security';
import { pathToFileURL } from 'node:url';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'yapper',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);
const smoke = process.argv.includes('--smoke');
let window: BrowserWindow | undefined;
app.whenReady().then(async () => {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.resolve(__dirname, '../../web/dist');
  protocol.handle('yapper', (request) => {
    const url = new URL(request.url);
    if (url.host !== 'app') return new Response('Not found', { status: 404 });
    let relative: string;
    try {
      relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    } catch {
      return new Response('Invalid path', { status: 400 });
    }
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(target).toString());
  });
  window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 780,
    show: !smoke,
    backgroundColor: '#171816',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  secureWindow(window, app.getVersion());
  installPTT(window);
  installScreenPicker(window);
  if (!smoke) installTray(window, trayIcon);
  await window.loadURL('yapper://app/');
  if (smoke) {
    const native = await import('uiohook-napi');
    if (typeof native.uIOhook.start !== 'function') throw new Error('Native PTT module missing');
    const result = await window.webContents.executeJavaScript(
      `({ title: document.title, node: typeof process, heading: document.querySelector('h1')?.textContent })`,
    );
    const passed =
      result.title.includes('Yapper') &&
      result.node === 'undefined' &&
      result.heading === 'yapper.';
    console.log(JSON.stringify({ desktopSmoke: passed, ...result }));
    app.exit(passed ? 0 : 1);
  }
});
app.on('window-all-closed', () => app.quit());
