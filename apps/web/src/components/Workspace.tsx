import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { Client, errorMessage, type Channel, type User } from '../lib/api';
import { Button } from './ui/button';
import { Conversation } from './Conversation';
const VoicePanel = lazy(() => import('./VoicePanel'));
export function Workspace({
  client,
  user,
  onLogout,
}: {
  client: Client;
  user: User;
  onLogout: () => void;
}) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState('');
  const [voiceID, setVoiceID] = useState('');
  const voiceChannel = channels.find((c) => c.id === voiceID);
  function selectChannel(channel: Channel) {
    setSelected(channel.id);
    if (channel.kind === 'voice') setVoiceID(channel.id);
  }
  const [error, setError] = useState('');
  const [invite, setInvite] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    client
      .request<{ channels: Channel[] }>('/channels', { signal: controller.signal })
      .then((data) => {
        setChannels(data.channels);
        setSelected(data.channels[0]?.id ?? '');
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [client]);
  async function logout() {
    try {
      await client.request('/auth/logout', { method: 'POST' });
      onLogout();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function createChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const channel = await client.request<Channel>('/channels', {
        method: 'POST',
        body: JSON.stringify({
          name: new FormData(form).get('name'),
          kind: new FormData(form).get('kind'),
        }),
      });
      setChannels((current) => [...current, channel]);
      selectChannel(channel);
      form.reset();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function createInvite() {
    try {
      const data = await client.request<{ invite: string }>('/auth/invites', { method: 'POST' });
      setInvite(data.invite);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const channel = channels.find((c) => c.id === selected);
  return (
    <main className="workspace">
      <aside className="server-rail" aria-label="Servers">
        <div className="server-mark">y.</div>
        <span className="rail-line" />
      </aside>
      <aside className="sidebar">
        <header className="instance">
          <strong>yapper.</strong>
          <span>{new URL(client.origin).host}</span>
        </header>
        <p className="eyebrow">Channels</p>
        <nav aria-label="Channels">
          {channels.map((c) => (
            <button
              className={c.id === selected ? 'channel active' : 'channel'}
              key={c.id}
              onClick={() => selectChannel(c)}
            >
              <span aria-hidden="true">{c.kind === 'voice' ? '◉' : '#'}</span>
              {c.name}
            </button>
          ))}
        </nav>
        {user.role === 'admin' ? (
          <details className="admin-tools">
            <summary>Server settings</summary>
            <form onSubmit={createChannel}>
              <label>
                New channel
                <input name="name" maxLength={64} required />
              </label>
              <label>
                Type
                <select name="kind">
                  <option value="text">Text</option>
                  <option value="voice">Voice</option>
                </select>
              </label>
              <Button type="submit" variant="outline">
                Create channel
              </Button>
            </form>
            <Button variant="outline" onClick={createInvite}>
              Create invitation
            </Button>
            {invite ? (
              <output className="invite">
                Valid for 24 hours. Share privately:<code>{invite}</code>
              </output>
            ) : null}
          </details>
        ) : null}
        <output className="error">{error}</output>
        {voiceChannel && channel?.kind !== 'voice' ? (
          <Button variant="outline" onClick={() => selectChannel(voiceChannel)}>
            Voice controls · {voiceChannel.name}
          </Button>
        ) : null}
        <footer className="user-bar">
          <div className="avatar">{user.username[0].toUpperCase()}</div>
          <div>
            <strong>{user.username}</strong>
            <small>{user.role}</small>
          </div>
          <Button size="sm" variant="ghost" onClick={logout}>
            Exit
          </Button>
        </footer>
      </aside>
      {channel?.kind === 'text' ? (
        <Conversation key={channel.id} client={client} channel={channel} />
      ) : null}
      {voiceChannel ? (
        <div hidden={channel?.kind !== 'voice'} className="voice-container">
          <Suspense fallback={<p className="empty">Loading voice…</p>}>
            <VoicePanel key={voiceChannel.id} client={client} channel={voiceChannel} />
          </Suspense>
        </div>
      ) : null}
      {!channel ? (
        <section className="empty">
          <h2>No channels yet.</h2>
          <p>Your administrator can create one.</p>
        </section>
      ) : null}
    </main>
  );
}
