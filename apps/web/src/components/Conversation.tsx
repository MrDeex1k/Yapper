import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Client, errorMessage, type Channel, type Message } from '../lib/api';
import { Button } from './ui/button';
export function Conversation({ client, channel }: { client: Client; channel: Channel }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [cursor, setCursor] = useState('');
  const [error, setError] = useState('');
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const pending = useRef({ content: '', id: '' });
  useEffect(() => {
    const controller = new AbortController();
    client
      .request<{ messages: Message[]; next_cursor: string }>(`/channels/${channel.id}/messages`, {
        signal: controller.signal,
      })
      .then((data) => {
        setMessages(data.messages.toReversed());
        setCursor(data.next_cursor);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
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
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!content.trim() || sending) return;
    setSending(true);
    setError('');
    if (pending.current.content !== content) pending.current = { content, id: crypto.randomUUID() };
    try {
      const message = await client.request<Message>(`/channels/${channel.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content, client_id: pending.current.id }),
      });
      setMessages((current) =>
        current.some((m) => m.id === message.id) ? current : [...current, message],
      );
      setContent('');
      pending.current = { content: '', id: '' };
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }
  return (
    <section className="conversation" aria-label={channel.name}>
      <header className="conversation-header">
        <span className="hash">#</span>
        <h2>{channel.name}</h2>
        <span className="channel-description">
          {channel.private ? 'Private conversation' : 'A little space for everyone'}
        </span>
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
        <Button type="submit" disabled={sending || !content.trim()}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </form>
      <output className="composer-error error">{error}</output>
    </section>
  );
}
