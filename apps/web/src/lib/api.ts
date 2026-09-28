export type User = { id: string; username: string; role: 'admin' | 'moderator' | 'member' };
export type Channel = { id: string; name: string; kind: 'text' | 'voice'; private: boolean };
export type Message = {
  id: string;
  channel_id: string;
  user_id: string;
  username: string;
  content: string;
  client_id: string;
  created_at: string;
};
export class Client {
  constructor(
    public readonly origin: string,
    public readonly token: string,
  ) {}
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.origin}/api/v1${path}`, {
      ...options,
      redirect: 'error',
      signal: options.signal ?? AbortSignal.timeout(12000),
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
    });
    if (response.status === 204) return undefined as T;
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message ?? 'Request failed.');
    return data as T;
  }
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}
