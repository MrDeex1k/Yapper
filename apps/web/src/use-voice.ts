import { useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  ConnectionState as MediaConnectionState,
  type RemoteAudioTrack,
  type RemoteParticipant,
} from "livekit-client";
import { request } from "./api";

type VoiceState = "disconnected" | "connecting" | "connected" | "reconnecting";
type VoiceParticipant = { identity: string; name: string; speaking: boolean };
export function useVoice() {
  const current = useRef<Room | null>(null);
  const sounds = useRef(new Map<RemoteAudioTrack, HTMLMediaElement[]>());
  const deafenedRef = useRef(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const mediaIdentity = useRef<string | null>(null);
  const [status, setStatus] = useState<VoiceState>("disconnected");
  const [channel, setChannel] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [deafened, setDeafened] = useState(false);
  const [error, setError] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  function clearAudio() {
    for (const [track, elements] of sounds.current) {
      track.detach();
      for (const element of elements) element.remove();
    }
    sounds.current.clear();
  }
  useEffect(
    () => () => {
      generation.current++;
      const room = current.current;
      current.current = null;
      void room?.disconnect();
      for (const [track, elements] of sounds.current) {
        track.detach();
        for (const element of elements) element.remove();
      }
      sounds.current.clear();
    },
    [],
  );
  async function leave() {
    generation.current++;
    const identity = mediaIdentity.current;
    mediaIdentity.current = null;
    const room = current.current;
    current.current = null;
    await room?.disconnect();
    clearAudio();
    setStatus("disconnected");
    setChannel(null);
    setParticipants([]);
    setMuted(true);
    setAudioBlocked(false);
    await request("/api/v1/voice/leave", identity ? { identity } : {});
  }
  async function join(channelId: string) {
    if (busy.current) return;
    busy.current = true;
    setError(false);
    let operation = -1;
    try {
      if (current.current) await leave();
      operation = ++generation.current;
      setStatus("connecting");
      const grant = await request<{
        url: string;
        token: string;
        identity: string;
        channelId: string;
      }>("/api/v1/voice/grant", { channelId });
      if (operation !== generation.current) {
        await request("/api/v1/voice/leave", { identity: grant.identity });
        return;
      }
      mediaIdentity.current = grant.identity;
      const room = new Room({ adaptiveStream: false, dynacast: false });
      current.current = room;
      setChannel(channelId);
      setMuted(true);
      const update = () => {
        if (current.current !== room) return;
        setParticipants(
          [room.localParticipant, ...room.remoteParticipants.values()].map((p) => ({
            identity: p.identity,
            name: p.name || p.identity,
            speaking: p.isSpeaking,
          })),
        );
      };
      room
        .on(RoomEvent.ParticipantConnected, update)
        .on(RoomEvent.ParticipantDisconnected, update)
        .on(RoomEvent.ActiveSpeakersChanged, update);
      room.on(RoomEvent.TrackSubscribed, (track, _publication, _participant: RemoteParticipant) => {
        if (track.kind !== Track.Kind.Audio) return;
        const audio = track as RemoteAudioTrack;
        const element = audio.attach();
        element.className = "remote-audio";
        element.muted = deafenedRef.current;
        document.body.append(element);
        sounds.current.set(audio, [element]);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        const audio = track as RemoteAudioTrack;
        for (const element of sounds.current.get(audio) ?? []) element.remove();
        audio.detach();
        sounds.current.delete(audio);
      });
      room.on(RoomEvent.ConnectionStateChanged, (state) => {
        if (current.current !== room) return;
        setStatus(
          state === MediaConnectionState.Connected
            ? "connected"
            : state === MediaConnectionState.Reconnecting ||
                state === MediaConnectionState.SignalReconnecting
              ? "reconnecting"
              : state === MediaConnectionState.Connecting
                ? "connecting"
                : "disconnected",
        );
      });
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!room.canPlaybackAudio));
      room.on(RoomEvent.Disconnected, () => {
        if (current.current === room) {
          current.current = null;
          clearAudio();
          setStatus("disconnected");
          setChannel(null);
          setParticipants([]);
          setMuted(true);
        }
      });
      await room.connect(grant.url, grant.token);
      if (operation !== generation.current) {
        await room.disconnect();
        return;
      }
      update();
      // Joining listens first. Microphone capture starts only after an explicit unmute.
      await room.startAudio();
      if (operation !== generation.current) return;
      setAudioBlocked(!room.canPlaybackAudio);
    } catch {
      if (operation !== -1 && operation !== generation.current) return;
      const room = current.current;
      current.current = null;
      await room?.disconnect();
      clearAudio();
      setStatus("disconnected");
      setChannel(null);
      setError(true);
      try {
        const identity = mediaIdentity.current;
        mediaIdentity.current = null;
        if (identity) await request("/api/v1/voice/leave", { identity });
      } catch {
        /* The server also reconciles revoked membership. */
      }
    } finally {
      busy.current = false;
    }
  }
  async function toggleMute() {
    const room = current.current;
    if (!room) return;
    setError(false);
    try {
      await room.localParticipant.setMicrophoneEnabled(muted);
      setMuted(!room.localParticipant.isMicrophoneEnabled);
    } catch {
      setError(true);
    }
  }
  async function toggleDeafen() {
    const next = !deafenedRef.current;
    if (next && current.current) {
      try {
        await current.current.localParticipant.setMicrophoneEnabled(false);
        setMuted(true);
      } catch {
        setError(true);
        return;
      }
    }
    deafenedRef.current = next;
    setDeafened(next);
    for (const elements of sounds.current.values())
      for (const element of elements) element.muted = next;
  }
  async function startAudio() {
    try {
      await current.current?.startAudio();
      setAudioBlocked(false);
    } catch {
      setError(true);
    }
  }
  return {
    status,
    channel,
    muted,
    deafened,
    error,
    audioBlocked,
    participants,
    join,
    leave,
    toggleMute,
    toggleDeafen,
    startAudio,
  };
}
