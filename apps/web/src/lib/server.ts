export function serverOrigin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Enter an HTTP or HTTPS server address without credentials.');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Enter only the server origin, without a path or query.');
  }
  return url.origin;
}

export function serverInfo(value: unknown): { name: string; version: string; protocol: 1 } {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('name' in value) ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    !('version' in value) ||
    typeof value.version !== 'string' ||
    !value.version.trim()
  ) {
    throw new Error('The server returned invalid connection information.');
  }
  if (!('protocol' in value) || value.protocol !== 1) {
    throw new Error('This server uses an unsupported protocol.');
  }
  return { name: value.name, version: value.version, protocol: 1 };
}
