import type { Room } from 'livekit-client';
import type { Client } from './api';
export async function joinRoom(client: Client, channel: string, room: Room, signal: AbortSignal) {
  const grant = await client.request<{
    token: string;
    url: string;
    allow_screen: boolean;
    allow_camera: boolean;
  }>(`/channels/${channel}/voice`, {
    method: 'POST',
    signal,
  });
  signal.throwIfAborted();
  await room.connect(grant.url, grant.token);
  signal.throwIfAborted();
  await room.localParticipant.setMicrophoneEnabled(true);
  signal.throwIfAborted();
  return grant;
}
