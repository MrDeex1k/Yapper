import type { Client } from './api';
export function subscribe(
  client: Client,
  channel: string,
  onChange: () => void,
  onStatus: (status: string) => void,
) {
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let socket: WebSocket | undefined;
  function connect() {
    const url = new URL('/api/v1/events', client.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url);
    onStatus('Connecting…');
    socket.onopen = () => {
      socket?.send(JSON.stringify({ token: client.token, channel_id: channel }));
    };
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data)) as { protocol: number; type: string };
        if (data.protocol !== 1) {
          socket?.close();
          onStatus('Unsupported server protocol');
          return;
        }
        attempt = 0;
        onStatus('Connected');
        onChange();
      } catch {
        socket?.close();
      }
    };
    socket.onclose = (event) => {
      if (stopped) return;
      if (event.code === 1008) {
        onStatus('Access expired. Sign in again.');
        return;
      }
      onStatus('Reconnecting…');
      timer = setTimeout(
        connect,
        Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) + Math.random() * 300,
      );
    };
  }
  connect();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    socket?.close();
  };
}
