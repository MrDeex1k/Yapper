import { subscribe } from '../lib/realtime';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Client,
  uploadAttachment,
  downloadAttachment,
  errorMessage,
  type Channel,
  type Message,
  type User,
} from '../lib/api';
import { Button } from './ui/button';
export function Conversation({
  client,
  channel,
  user,
}: {
  client: Client;
  channel: Channel;
  user: User;
}) {
  const [connection, setConnection] = useState('Connecting…');
  const [messages, setMessages] = useState<Message[]>([]);
  const [cursor, setCursor] = useState('');
  const [error, setError] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const pending = useRef<{ content: string; id: string; file: File | null; fileID: string }>({
    content: '',
    id: '',
    file: null,
    fileID: '',
  });
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    let again = false;
    async function refresh() {
      if (running) {
        again = true;
        return;
      }
      running = true;
      do {
        again = false;
        try {
          const data = await client.request<{ messages: Message[]; next_cursor: string }>(
            `/channels/${channel.id}/messages`,
            { signal: controller.signal },
          );
          setMessages(data.messages.toReversed());
          setCursor(data.next_cursor);
          setError('');
        } catch (error) {
          if (!controller.signal.aborted) setError(errorMessage(error));
        }
      } while (again && !controller.signal.aborted);
      running = false;
    }
    const stop = subscribe(client, channel.id, () => void refresh(), setConnection);
    return () => {
      stop();
      controller.abort();
    };
  }, [client, channel.id]);
  async function older() {
    try {
      const data = await client.request<{ messages: Message[]; next_cursor: string }>(
        `/channels/${channel.id}/messages?before=${cursor}`,
      );
      setMessages((current) =>
        [...data.messages.toReversed(), ...current].filter(
          (m, i, a) => a.findIndex((x) => x.id === m.id) === i,
        ),
      );
      setCursor(data.next_cursor);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if ((!content.trim() && !file) || sending) return;
    setSending(true);
    setError('');
    if (pending.current.content !== content || pending.current.file !== file)
      pending.current = { content, id: crypto.randomUUID(), file, fileID: '' };
    try {
      if (file && !pending.current.fileID)
        pending.current.fileID = (await uploadAttachment(client, channel.id, file)).id;
      const message = await client.request<Message>(`/channels/${channel.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: content.trim() || file?.name || '',
          client_id: pending.current.id,
          file_id: pending.current.fileID,
        }),
      });
      setMessages((current) =>
        current.some((m) => m.id === message.id) ? current : [...current, message],
      );
      setContent('');
      pending.current = { content: '', id: '', file: null, fileID: '' };
      setFile(null);
      form.reset();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }
  async function remove(message: Message) {
    try {
      await client.request(`/channels/${channel.id}/messages/${message.id}`, { method: 'DELETE' });
      setMessages((current) => current.filter((m) => m.id !== message.id));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <section className="conversation" aria-label={channel.name}>
      <header className="conversation-header">
        <span className="hash">#</span>
        <h2>{channel.name}</h2>
        <span className="channel-description">{connection}</span>
      </header>
      <div className="history" role="log" aria-label="Messages">
        {cursor ? (
          <Button variant="ghost" onClick={older}>
            Load earlier messages
          </Button>
        ) : null}
        {messages.length === 0 ? (
          <div className="empty">
            <span aria-hidden="true">#</span>
            <h3>The start of {channel.name}.</h3>
            <p>Say something. Make yourself at home.</p>
          </div>
        ) : null}
        {messages.map((message) => (
          <article className="message" key={message.id}>
            <div className="avatar" aria-hidden="true">
              {message.username.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <header>
                <strong>{message.username}</strong>
                <time dateTime={message.created_at}>
                  {new Date(message.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </header>
              <p>{message.content}</p>
              {message.file_id ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void downloadAttachment(client, message.file_id).catch((e) =>
                      setError(errorMessage(e)),
                    )
                  }
                >
                  Download attachment
                </Button>
              ) : null}
              {message.user_id === user.id || user.role !== 'member' ? (
                <Button size="sm" variant="ghost" onClick={() => void remove(message)}>
                  Delete message
                </Button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      <form className="composer" onSubmit={send}>
        <label className="sr-only" htmlFor="message">
          Message {channel.name}
        </label>
        <input
          id="message"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={4000}
          placeholder={`Message #${channel.name}`}
          disabled={sending}
        />
        <label className="file-picker">
          Attach
          <input
            type="file"
            disabled={sending}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <Button type="submit" disabled={sending || (!content.trim() && !file)}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </form>
      <output className="composer-error error">{error}</output>
    </section>
  );
}
