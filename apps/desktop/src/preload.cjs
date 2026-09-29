const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("yapperDesktop", {
  getServer: () => ipcRenderer.invoke("yapper:get-server"),
  setServer: (address) => ipcRenderer.invoke("yapper:set-server", address),
});
