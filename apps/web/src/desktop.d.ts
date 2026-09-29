export {};
declare global {
  interface Window {
    yapperDesktop?: {
      getServer: () => Promise<string | null>;
      setServer: (address: string) => Promise<string>;
    };
  }
}
