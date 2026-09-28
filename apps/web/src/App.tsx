import { savedServers, rememberServer } from './lib/servers';
import { AuthPanel } from './components/AuthPanel';
import { Workspace } from './components/Workspace';
import { Client, type User } from './lib/api';
import { useState, type FormEvent } from 'react';
import { serverOrigin } from './lib/server';
import { Button } from './components/ui/button';
export function App() {
  const [connected, setConnected] = useState('');
  const [session, setSession] = useState<{ client: Client; user: User } | null>(null);
  const [origin, setOrigin] = useState(
    window.location.protocol === 'yapper:' ? 'http://127.0.0.1:18088' : window.location.origin,
  );
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
      rememberServer(url);
      setConnected(url);
    } catch (error) {
      setFailed(true);
      setStatus(error instanceof Error ? error.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  }
  if (session)
    return (
      <Workspace client={session.client} user={session.user} onLogout={() => setSession(null)} />
    );
  if (connected)
    return (
      <AuthPanel
        origin={connected}
        onBack={() => setConnected('')}
        onSession={(token, user) => setSession({ client: new Client(connected, token), user })}
      />
    );
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
            list="saved-servers"
            type="url"
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
            required
            placeholder="https://chat.example.com"
          />
        </label>
        <datalist id="saved-servers">
          {savedServers().map((server) => (
            <option key={server} value={server}>
              {server}
            </option>
          ))}
        </datalist>
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
