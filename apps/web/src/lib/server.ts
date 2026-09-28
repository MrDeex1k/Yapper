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
