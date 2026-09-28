import { useState, type FormEvent } from 'react';
import { Client, errorMessage, type User, type Channel } from '../lib/api';
import { Button } from './ui/button';
type ManagedUser = User & { banned: boolean };
export function Moderation({
  client,
  user,
  channels,
}: {
  client: Client;
  user: User;
  channels: Channel[];
}) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  async function load() {
    try {
      const data = await client.request<{ users: ManagedUser[] }>('/admin/users');
      setUsers(data.users);
      setLoaded(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function change(target: ManagedUser, body: { role?: User['role']; banned?: boolean }) {
    try {
      const updated = await client.request<ManagedUser>(`/admin/users/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setUsers((current) => current.map((u) => (u.id === updated.id ? updated : u)));
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function membership(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await client.request(`/channels/${data.get('channel')}/members/${data.get('user')}`, {
        method: data.get('action') === 'grant' ? 'PUT' : 'DELETE',
      });
      setError('Membership updated.');
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <details className="admin-tools">
      <summary>People and permissions</summary>
      <Button variant="outline" onClick={load}>
        {loaded ? 'Refresh people' : 'Load people'}
      </Button>
      {users.map((target) => (
        <div key={target.id} className="moderation-user">
          <strong>{target.username}</strong>
          <small>{target.banned ? 'Banned' : target.role}</small>
          {user.role === 'admin' ? (
            <label>
              Role for {target.username}
              <select
                value={target.role}
                onChange={(e) => void change(target, { role: e.target.value as User['role'] })}
              >
                <option value="member">Member</option>
                <option value="moderator">Moderator</option>
                <option value="admin">Administrator</option>
              </select>
            </label>
          ) : null}
          {target.id !== user.id && (user.role === 'admin' || target.role === 'member') ? (
            <Button
              variant="outline"
              onClick={() => void change(target, { banned: !target.banned })}
            >
              {target.banned ? 'Unban' : 'Ban'} {target.username}
            </Button>
          ) : null}
        </div>
      ))}
      {user.role === 'admin' && loaded ? (
        <form onSubmit={membership}>
          <label>
            Channel
            <select name="channel">
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Person
            <select name="user">
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                </option>
              ))}
            </select>
          </label>
          <label>
            Access
            <select name="action">
              <option value="grant">Grant membership</option>
              <option value="revoke">Revoke membership</option>
            </select>
          </label>
          <Button type="submit" variant="outline">
            Apply membership
          </Button>
          <small>Public channels remain accessible to all active members.</small>
        </form>
      ) : null}
      <output className="error">{error}</output>
      <small>Role changes revoke all sessions. Up to 500 accounts are listed.</small>
    </details>
  );
}
