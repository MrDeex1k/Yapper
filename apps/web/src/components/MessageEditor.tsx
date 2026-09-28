import { useState, type FormEvent } from 'react';
import { Client, errorMessage, type Message } from '../lib/api';
import { Button } from './ui/button';
export function MessageEditor({
  client,
  message,
  onEdited,
}: {
  client: Client;
  message: Message;
  onEdited: (update: Pick<Message, 'content' | 'edited_at'>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      const update = await client.request<Pick<Message, 'content' | 'edited_at'>>(
        `/channels/${message.channel_id}/messages/${message.id}`,
        { method: 'PATCH', body: JSON.stringify({ content }) },
      );
      onEdited(update);
      setEditing(false);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  if (!editing)
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setContent(message.content);
          setEditing(true);
        }}
      >
        Edit message
      </Button>
    );
  return (
    <form className="message-editor" onSubmit={save}>
      <label>
        Edit message
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
          maxLength={4000}
        />
      </label>
      <Button size="sm" type="submit">
        Save
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      <output className="error">{error}</output>
    </form>
  );
}
