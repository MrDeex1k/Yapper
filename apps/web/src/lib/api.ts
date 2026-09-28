export type User = { id: string; username: string; role: 'admin' | 'moderator' | 'member' };
export type Channel = { id: string; name: string; kind: 'text' | 'voice'; private: boolean };
export type Message = {
  file_id: string;
  edited_at: string | null;
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
export type Attachment = { id: string; filename: string; bytes: number; channel_id: string };
export async function uploadAttachment(
  client: Client,
  channel: string,
  file: File,
): Promise<Attachment> {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(`${client.origin}/api/v1/channels/${channel}/files`, {
    method: 'POST',
    body,
    headers: { Authorization: `Bearer ${client.token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? 'Upload failed');
  return data;
}
export async function downloadAttachment(client: Client, id: string) {
  const [metadata, response] = await Promise.all([
    client.request<Attachment>(`/files/${id}/info`),
    fetch(`${client.origin}/api/v1/files/${id}`, {
      headers: { Authorization: `Bearer ${client.token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    }),
  ]);
  if (!response.ok) throw new Error('File unavailable or access revoked');
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = metadata.filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
