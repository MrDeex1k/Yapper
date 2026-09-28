export interface DesktopBridge {
  configurePTT(key: 'F8' | 'F9' | 'F10' | null): Promise<{ enabled: boolean; reason: string }>;
  onPTT(listener: (pressed: boolean) => void): () => void;
  version(): Promise<string>;
  openExternal(url: string): Promise<void>;
}
