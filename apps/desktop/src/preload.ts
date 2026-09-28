import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from './bridge';
const bridge: DesktopBridge = Object.freeze<DesktopBridge>({
  configurePTT: (key) => ipcRenderer.invoke('desktop:ptt-configure', key),
  onPTT: (listener) => {
    const handle = (_event: unknown, pressed: boolean) => listener(pressed === true);
    ipcRenderer.on('desktop:ptt', handle);
    return () => {
      ipcRenderer.removeListener('desktop:ptt', handle);
    };
  },
  setVoiceActive: (active) => ipcRenderer.invoke('desktop:voice-active', active),
  version: () => ipcRenderer.invoke('desktop:version'),
  openExternal: (url: string) => ipcRenderer.invoke('desktop:external', url),
});
contextBridge.exposeInMainWorld('yapperDesktop', bridge);
