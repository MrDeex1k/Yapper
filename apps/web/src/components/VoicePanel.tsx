import { joinRoom } from '../lib/join-room';
import { ScreenShare } from './ScreenShare';
import { VideoStage } from './VideoStage';
import { VoiceControls } from './VoiceControls';
import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteTrack, type Participant } from 'livekit-client';
import { Client, errorMessage, type Channel } from '../lib/api';
import { Button } from './ui/button';
export default function VoicePanel({ client, channel }: { client: Client; channel: Channel }) {
  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true }));
  const joining = useRef<AbortController | null>(null);
  const audio = useRef<HTMLDivElement>(null);
  const [speakers, setSpeakers] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState('Disconnected');
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [allowScreen, setAllowScreen] = useState(false);
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
    const activeSpeakers = (participants: Participant[]) =>
      setSpeakers(new Set(participants.map((p) => p.identity)));
    room.on(RoomEvent.ActiveSpeakersChanged, activeSpeakers);
    const disconnected = () => {
      setJoined(false);
      setStatus('Disconnected');
      setParticipants([]);
      setSpeakers(new Set());
    };
    const reconnecting = () => setStatus('Reconnecting…');
    const reconnected = () => {
      setStatus('Connected');
      update();
    };
    room.on(RoomEvent.Reconnecting, reconnecting);
    room.on(RoomEvent.Reconnected, reconnected);
    room.on(RoomEvent.ParticipantConnected, update);
    room.on(RoomEvent.ParticipantDisconnected, update);
    room.on(RoomEvent.TrackSubscribed, attach);
    room.on(RoomEvent.TrackUnsubscribed, detach);
    room.on(RoomEvent.Disconnected, disconnected);
    return () => {
      joining.current?.abort();
      room.off(RoomEvent.Reconnecting, reconnecting);
      room.off(RoomEvent.Reconnected, reconnected);
      room.off(RoomEvent.ActiveSpeakersChanged, activeSpeakers);
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
  useEffect(() => {
    void window.yapperDesktop?.setVoiceActive(joined);
    return () => {
      void window.yapperDesktop?.setVoiceActive(false);
    };
  }, [joined]);
  async function join() {
    setBusy(true);
    setError('');
    setStatus('Connecting…');
    const controller = new AbortController();
    joining.current = controller;
    try {
      const grant = await joinRoom(client, channel.id, room, controller.signal);
      setAllowScreen(grant.allow_screen);
      setJoined(true);
      setStatus('Connected');
      setParticipants([room.localParticipant, ...room.remoteParticipants.values()]);
    } catch (e) {
      await room.disconnect();
      if (controller.signal.aborted) return;
      setStatus('Disconnected');
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function leave() {
    joining.current?.abort();
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
        {joined ? (
          <>
            <ScreenShare room={room} allowed={allowScreen} onError={setError} />
            <VideoStage room={room} />
          </>
        ) : null}
        <ul className="participants">
          {participants.map((p) => (
            <li key={p.identity} className={speakers.has(p.identity) ? 'speaking' : ''}>
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
