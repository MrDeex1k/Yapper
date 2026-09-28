export interface DesktopBridge {
  version(): Promise<string>;
  openExternal(url: string): Promise<void>;
}
