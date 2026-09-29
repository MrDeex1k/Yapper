const { contextBridge, ipcRenderer }: typeof import("electron") = require("electron");
contextBridge.exposeInMainWorld("yapperDesktop", {
  getServer: () => ipcRenderer.invoke("yapper:get-server"),
  setServer: (address: string) => ipcRenderer.invoke("yapper:set-server", address),
});
