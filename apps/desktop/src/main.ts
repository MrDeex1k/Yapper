import { app, BrowserWindow, session } from "electron";
import { fileURLToPath } from "node:url";

// Foundation smoke shell only. Network credentials and microphone permissions
// are intentionally added with the tested Stage 1 transport contract.
await app.whenReady();
session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
  callback(false),
);
session.defaultSession.setPermissionCheckHandler(() => false);
function openWindow() {
  const window = new BrowserWindow({
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
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  void window.loadFile(fileURLToPath(new URL("../../web/dist/index.html", import.meta.url)));
}
openWindow();
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) openWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
