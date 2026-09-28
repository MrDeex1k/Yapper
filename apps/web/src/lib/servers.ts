import { serverOrigin } from './server';
const key = 'yapper.servers.v1';
export function savedServers(): string[] {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(values)) return [];
    return [
      ...new Set(
        values
          .filter((v): v is string => typeof v === 'string')
          .slice(0, 20)
          .map(serverOrigin),
      ),
    ];
  } catch {
    return [];
  }
}
export function rememberServer(origin: string) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify(
        [serverOrigin(origin), ...savedServers().filter((v) => v !== origin)].slice(0, 20),
      ),
    );
  } catch {
    /* Private browsing may disable local storage; connecting still works. */
  }
}
