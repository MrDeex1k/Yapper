import { useState, type FormEvent } from 'react';
import { Client, errorMessage, type User } from '../lib/api';
import { Button } from './ui/button';
type Mode = 'login' | 'register' | 'bootstrap';
const modes = {
  login: {
    heading: 'Welcome back.',
    action: 'Sign in',
    secret: '',
    autocomplete: 'current-password',
  },
  register: {
    heading: 'You’re invited.',
    action: 'Join server',
    secret: 'Invitation',
    autocomplete: 'new-password',
  },
  bootstrap: {
    heading: 'Make this place yours.',
    action: 'Create administrator',
    secret: 'Setup token',
    autocomplete: 'new-password',
  },
} as const;
async function authenticate(origin: string, mode: Mode, form: FormData) {
  const client = new Client(origin, '');
  const credentials = {
    username: String(form.get('username')),
    password: String(form.get('password')),
  };
  if (mode === 'bootstrap')
    await client.request('/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify({ ...credentials, token: form.get('secret') }),
    });
  const path = mode === 'register' ? '/auth/register' : '/auth/login';
  const body = mode === 'register' ? { ...credentials, invite: form.get('secret') } : credentials;
  return client.request<{ token: string; user: User }>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
export function AuthPanel({
  origin,
  onSession,
  onBack,
}: {
  origin: string;
  onSession: (token: string, user: User) => void;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<Mode>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const copy = modes[mode];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const result = await authenticate(origin, mode, form);
      onSession(result.token, result.user);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="connect auth">
      <p className="eyebrow">{origin}</p>
      <h1>
        yapper<span>.</span>
      </h1>
      <p className="intro">{copy.heading}</p>
      <form className="connection-form" onSubmit={submit}>
        <label>
          Username
          <input name="username" autoComplete="username" pattern="[a-z0-9_-]{3,32}" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={copy.autocomplete}
            minLength={12}
            maxLength={72}
            required
          />
        </label>
        {copy.secret ? (
          <label>
            {copy.secret}
            <input name="secret" type="password" autoComplete="off" required />
          </label>
        ) : null}
        <Button type="submit" disabled={busy}>
          {busy ? 'Please wait…' : copy.action}
        </Button>
        <output className="error">{error}</output>
      </form>
      <nav className="auth-options" aria-label="Account options">
        {(Object.keys(modes) as Mode[])
          .filter((key) => key !== mode)
          .map((key) => (
            <Button
              key={key}
              variant="ghost"
              onClick={() => {
                setMode(key);
                setError('');
              }}
            >
              {modes[key].action}
            </Button>
          ))}
        <Button variant="ghost" onClick={onBack}>
          Change server
        </Button>
      </nav>
    </main>
  );
}
