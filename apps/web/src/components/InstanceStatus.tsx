import { useState } from 'react';
import { Client, errorMessage } from '../lib/api';
import { Button } from './ui/button';
type Status = {
  version: string;
  ready: boolean;
  database: string;
  database_bytes: number;
  users: number;
  channels: number;
  messages: number;
  media: string;
  attachment_bytes: number;
  media_policy: { camera: boolean; screen: boolean; max_screens: number };
};
export function InstanceStatus({ client }: { client: Client }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  async function load() {
    try {
      setStatus(await client.request<Status>('/admin/status'));
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <details className="admin-tools">
      <summary>Instance status</summary>
      <Button variant="outline" onClick={load}>
        Check services
      </Button>
      {status ? (
        <dl>
          <dt>Version</dt>
          <dd>{status.version}</dd>
          <dt>Server</dt>
          <dd>{status.ready ? 'Ready' : 'Draining'}</dd>
          <dt>Database / media</dt>
          <dd>
            {status.database} / {status.media}
          </dd>
          <dt>Database size</dt>
          <dd>{(status.database_bytes / 1024 / 1024).toFixed(1)} MiB</dd>
          <dt>Attachment payload</dt>
          <dd>{(status.attachment_bytes / 1024 / 1024).toFixed(1)} MiB</dd>
          <dt>Media policy</dt>
          <dd>
            Camera {status.media_policy.camera ? 'on' : 'off'} · Screen{' '}
            {status.media_policy.screen ? 'on' : 'off'} · Max screens{' '}
            {status.media_policy.max_screens}
          </dd>
          <dt>Users / channels / messages</dt>
          <dd>
            {status.users} / {status.channels} / {status.messages}
          </dd>
        </dl>
      ) : null}
      <output className="error">{error}</output>
    </details>
  );
}
