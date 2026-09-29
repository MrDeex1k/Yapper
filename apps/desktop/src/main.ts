import { app, BrowserWindow, ipcMain, safeStorage, session } from "electron";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGateway, type SavedState } from "./gateway.js";

await app.whenReady();
if (!(await safeStorage.isAsyncEncryptionAvailable()))
  throw new Error("OS-protected credential storage is unavailable");
const storage = join(app.getPath("userData"), "servers.encrypted");
let state: SavedState = { selected: null, jars: {} };
try {
  const encrypted = await readFile(storage);
  const decrypted = await safeStorage.decryptStringAsync(encrypted);
  state = JSON.parse(decrypted.result) as SavedState;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT")
    throw new Error("Cannot unlock saved server credentials");
}
const gateway = await createGateway({
  assets: fileURLToPath(new URL("../renderer", import.meta.url)),
  state,
  allowLoopbackHTTP: !app.isPackaged,
  save: async (value) => {
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(value));
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(storage + ".tmp", encrypted, { mode: 0o600 });
    await rename(storage + ".tmp", storage);
  },
});
let window: BrowserWindow | null = null;
const trusted = (url: string) => {
  try {
    return new URL(url).origin === gateway.origin;
  } catch {
    return false;
  }
};
session.defaultSession.webRequest.onBeforeSendHeaders(
  { urls: [`${gateway.origin}/*`, `${gateway.origin.replace("http:", "ws:")}/*`] },
  (details, callback) => {
    if (details.webContentsId !== window?.webContents.id) {
      callback({ cancel: true });
      return;
    }
    callback({ requestHeaders: { ...details.requestHeaders, "X-Yapper-Desktop": gateway.secret } });
  },
);
session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
  callback(
    contents === window?.webContents &&
      trusted(details.requestingUrl) &&
      details.isMainFrame &&
      permission === "media" &&
      "mediaTypes" in details &&
      details.mediaTypes?.every((type) => type === "audio") === true,
  ),
);
session.defaultSession.setPermissionCheckHandler(
  (contents, permission, requestingOrigin) =>
    contents === window?.webContents && trusted(requestingOrigin) && permission === "media",
);
for (const channel of ["yapper:get-server", "yapper:set-server"])
  ipcMain.handle(channel, async (event, address: unknown) => {
    if (
      event.sender !== window?.webContents ||
      !event.senderFrame ||
      !trusted(event.senderFrame.url)
    )
      throw new Error("access_denied");
    if (channel === "yapper:get-server") return gateway.getServer();
    if (typeof address !== "string" || address.length > 2048) throw new Error("invalid_server");
    return gateway.setServer(address);
  });
function openWindow() {
  window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 360,
    minHeight: 600,
    backgroundColor: "#151817",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      preload: fileURLToPath(new URL("preload.cjs", import.meta.url)),
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!trusted(url)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.on("closed", () => {
    window = null;
  });
  void window.loadURL(gateway.origin);
}
openWindow();
app.on("activate", () => {
  if (!window) openWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => gateway.close());
