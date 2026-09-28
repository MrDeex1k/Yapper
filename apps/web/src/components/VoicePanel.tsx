import { VoiceControls } from './VoiceControls';
import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteTrack, type Participant } from 'livekit-client';
import { Client, errorMessage, type Channel } from '../lib/api';
import { Button } from './ui/button';
export default function VoicePanel({ client, channel }: { client: Client; channel: Channel }) {
  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true }));
  const audio = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Disconnected');
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  useEffect(() => {
    const update = () =>
      setParticipants([room.localParticipant, ...room.remoteParticipants.values()]);
    const attach = (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) {
        const element = track.attach();
        element.muted = audio.current?.dataset.deaf === 'true';
        audio.current?.append(element);
      }
    };
    const detach = (track: RemoteTrack) => {
      for (const element of track.detach()) element.remove();
    };
    const disconnected = () => {
      setJoined(false);
      setStatus('Disconnected');
    };
    room.on(RoomEvent.ParticipantConnected, update);
    room.on(RoomEvent.ParticipantDisconnected, update);
    room.on(RoomEvent.TrackSubscribed, attach);
    room.on(RoomEvent.TrackUnsubscribed, detach);
    room.on(RoomEvent.Disconnected, disconnected);
    return () => {
      room.off(RoomEvent.ParticipantConnected, update);
      room.off(RoomEvent.ParticipantDisconnected, update);
      room.off(RoomEvent.TrackSubscribed, attach);
      room.off(RoomEvent.TrackUnsubscribed, detach);
      room.off(RoomEvent.Disconnected, disconnected);
      const active = room.state !== 'disconnected';
      void room.disconnect();
      if (active)
        void client.request(`/channels/${channel.id}/voice`, { method: 'DELETE' }).catch(() => {});
    };
  }, [client, channel.id, room]);
  async function join() {
    setBusy(true);
    setError('');
    setStatus('Connecting…');
    try {
      const grant = await client.request<{ token: string; url: string }>(
        `/channels/${channel.id}/voice`,
        { method: 'POST' },
      );
      await room.connect(grant.url, grant.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setJoined(true);
      setStatus('Connected');
      setParticipants([room.localParticipant, ...room.remoteParticipants.values()]);
    } catch (e) {
      await room.disconnect();
      setStatus('Disconnected');
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function leave() {
    await room.disconnect();
    setJoined(false);
    setStatus('Disconnected');
    try {
      await client.request(`/channels/${channel.id}/voice`, { method: 'DELETE' });
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <section className="voice-panel">
      <header className="conversation-header">
        <span className="hash" aria-hidden="true">
          ◉
        </span>
        <h2>{channel.name}</h2>
        <span className="channel-description">{status}</span>
      </header>
      <div className="voice-body">
        <p className="eyebrow">Voice channel</p>
        <h3>Room for a conversation.</h3>
        <p>Your microphone turns on only when you choose to join.</p>
        {joined ? (
          <Button variant="outline" onClick={leave}>
            Leave voice
          </Button>
        ) : (
          <Button onClick={join} disabled={busy}>
            {busy ? 'Connecting…' : 'Join voice'}
          </Button>
        )}
        {joined ? (
          <VoiceControls
            room={room}
            onDeafen={(value) => {
              if (audio.current) {
                audio.current.dataset.deaf = String(value);
                audio.current.querySelectorAll('audio').forEach((element) => {
                  element.muted = value;
                });
              }
            }}
            onError={setError}
          />
        ) : null}
        <ul className="participants">
          {participants.map((p) => (
            <li key={p.identity}>
              <span className="avatar" aria-hidden="true">
                {(p.name || p.identity).slice(0, 1).toUpperCase()}
              </span>
              {p.name || p.identity}
            </li>
          ))}
        </ul>
        <output className="error">{error}</output>
        <div ref={audio} />
      </div>
    </section>
  );
}
