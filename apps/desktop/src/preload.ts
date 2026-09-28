import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from './bridge';
const bridge: DesktopBridge = Object.freeze({
  version: () => ipcRenderer.invoke('desktop:version'),
  openExternal: (url: string) => ipcRenderer.invoke('desktop:external', url),
});
contextBridge.exposeInMainWorld('yapperDesktop', bridge);
