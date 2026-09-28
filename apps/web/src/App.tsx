import { useRef, useState, type FormEvent } from 'react';
import { serverInfo, serverOrigin } from './lib/server';
import { Button } from './components/ui/button';
export function App() {
  const requestId = useRef(0);
  const [origin, setOrigin] = useState(window.location.origin);
  const [connection, setConnection] = useState<{
    phase: 'idle' | 'connecting' | 'connected' | 'failed';
    message: string;
  }>({ phase: 'idle', message: '' });
  const busy = connection.phase === 'connecting';
  const failed = connection.phase === 'failed';
  async function connect(event: FormEvent) {
    event.preventDefault();
    const currentRequestId = ++requestId.current;
    setConnection({ phase: 'connecting', message: 'Connecting…' });
    try {
      const url = serverOrigin(origin);
      const response = await fetch(`${url}/api/v1/info`, {
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('Server is not available.');
      const info = serverInfo(await response.json());
      if (currentRequestId === requestId.current) {
        setConnection({
          phase: 'connected',
          message: `Connected to ${info.name} · ${info.version}`,
        });
      }
    } catch (error) {
      if (currentRequestId === requestId.current) {
        setConnection({
          phase: 'failed',
          message: error instanceof Error ? error.message : 'Could not connect.',
        });
      }
    }
  }
  return (
    <main className="connect">
      <p className="eyebrow">A place for your people</p>
      <h1>
        yapper<span>.</span>
      </h1>
      <p className="intro">Your conversations. Your server.</p>
      <form className="connection-form" onSubmit={connect}>
        <label htmlFor="server">
          Server address
          <input
            id="server"
            type="url"
            value={origin}
            onChange={(event) => {
              requestId.current += 1;
              setOrigin(event.target.value);
              setConnection({ phase: 'idle', message: '' });
            }}
            required
            placeholder="https://chat.example.com"
          />
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? 'Connecting…' : 'Connect to server'} <span aria-hidden="true">↗</span>
        </Button>
        <output className={failed ? 'status error' : 'status'}>{connection.message}</output>
      </form>
      <p className="footnote">
        An independent home for your community.
        <br />
        Ask your host for the server address.
      </p>
    </main>
  );
}
