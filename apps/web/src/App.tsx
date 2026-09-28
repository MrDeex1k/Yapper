import { useState, type FormEvent } from 'react';
import { serverOrigin } from './lib/server';
import { Button } from './components/ui/button';
export function App() {
  const [origin, setOrigin] = useState(window.location.origin);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailed(false);
    setStatus('Connecting…');
    try {
      const url = serverOrigin(origin);
      const response = await fetch(`${url}/api/v1/info`, {
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('Server is not available.');
      const info = (await response.json()) as { name: string; version: string; protocol: number };
      if (info.protocol !== 1) throw new Error('This server uses an unsupported protocol.');
      setStatus(`Connected to ${info.name} · ${info.version}`);
    } catch (error) {
      setFailed(true);
      setStatus(error instanceof Error ? error.message : 'Could not connect.');
    } finally {
      setBusy(false);
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
            onChange={(event) => setOrigin(event.target.value)}
            required
            placeholder="https://chat.example.com"
          />
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? 'Connecting…' : 'Connect to server'} <span aria-hidden="true">↗</span>
        </Button>
        <output className={failed ? 'status error' : 'status'}>{status}</output>
      </form>
      <p className="footnote">
        An independent home for your community.
        <br />
        Ask your host for the server address.
      </p>
    </main>
  );
}
