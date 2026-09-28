import { useState, type FormEvent } from 'react';
import { Client, errorMessage, type Message, type Channel } from '../lib/api';
import { Button } from './ui/button';
export function Search({
  client,
  channels,
  onSelect,
}: {
  client: Client;
  channels: Channel[];
  onSelect: (channel: Channel) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [cursor, setCursor] = useState('');
  const [error, setError] = useState('');
  async function search(event?: FormEvent) {
    event?.preventDefault();
    try {
      const data = await client.request<{ messages: Message[]; next_cursor: string }>(
        `/search?q=${encodeURIComponent(query)}${event ? '' : `&before=${cursor}`}`,
      );
      setResults(data.messages);
      setCursor(data.next_cursor);
      setError(data.messages.length ? '' : 'No matching messages.');
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <details className="admin-tools">
      <summary>Search history</summary>
      <form onSubmit={search}>
        <label>
          Search
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor('');
            }}
            minLength={2}
            maxLength={200}
            required
          />
        </label>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      {results.map((message) => (
        <article className="search-result" key={message.id}>
          <strong>{message.username}</strong>
          <p>{message.content}</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const channel = channels.find((c) => c.id === message.channel_id);
              if (channel) onSelect(channel);
            }}
          >
            Open channel
          </Button>
        </article>
      ))}
      {cursor ? (
        <Button variant="ghost" onClick={() => void search()}>
          Earlier matches
        </Button>
      ) : null}
      <output>{error}</output>
    </details>
  );
}
