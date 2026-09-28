import { PushToTalk } from './PushToTalk';
import { useEffect, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import { errorMessage } from '../lib/api';
import { Button } from './ui/button';
export function VoiceControls({
  room,
  onDeafen,
  onError,
}: {
  room: Room;
  onDeafen: (deaf: boolean) => void;
  onError: (error: string) => void;
}) {
  const [muted, setMuted] = useState(!room.localParticipant.isMicrophoneEnabled);
  const [deaf, setDeaf] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    let active = true;
    Room.getLocalDevices()
      .then((value) => {
        if (active) setDevices(value);
      })
      .catch((e) => onError(errorMessage(e)));
    const update = () => setMuted(!room.localParticipant.isMicrophoneEnabled);
    room.on(RoomEvent.TrackMuted, update);
    room.on(RoomEvent.TrackUnmuted, update);
    room.on(RoomEvent.LocalTrackPublished, update);
    return () => {
      active = false;
      room.off(RoomEvent.TrackMuted, update);
      room.off(RoomEvent.TrackUnmuted, update);
      room.off(RoomEvent.LocalTrackPublished, update);
    };
  }, [room, onError]);
  async function toggleMute() {
    try {
      await room.localParticipant.setMicrophoneEnabled(muted);
      setMuted(!room.localParticipant.isMicrophoneEnabled);
    } catch (e) {
      onError(errorMessage(e));
    }
  }
  async function toggleDeaf() {
    const next = !deaf;
    if (next) {
      await room.localParticipant.setMicrophoneEnabled(false);
      setMuted(true);
    }
    onDeafen(next);
    setDeaf(next);
  }
  async function switchDevice(kind: 'audioinput' | 'audiooutput', id: string) {
    try {
      await room.switchActiveDevice(kind, id);
    } catch (e) {
      onError(errorMessage(e));
    }
  }
  return (
    <div className="voice-controls">
      <PushToTalk room={room} onError={onError} />
      <div className="voice-actions">
        <Button variant="outline" aria-pressed={muted} onClick={toggleMute}>
          {muted ? 'Unmute' : 'Mute'}
        </Button>
        <Button
          variant="outline"
          aria-pressed={deaf}
          onClick={() => void toggleDeaf().catch((e) => onError(errorMessage(e)))}
        >
          {deaf ? 'Undeafen' : 'Deafen'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => void room.startAudio().catch((e) => onError(errorMessage(e)))}
        >
          Enable audio playback
        </Button>
      </div>
      <div className="device-selects">
        <DeviceSelect
          devices={devices}
          kind="audioinput"
          label="Microphone"
          onChange={switchDevice}
        />
        <DeviceSelect
          devices={devices}
          kind="audiooutput"
          label="Speakers"
          onChange={switchDevice}
        />
      </div>
    </div>
  );
}
function DeviceSelect({
  devices,
  kind,
  label,
  onChange,
}: {
  devices: MediaDeviceInfo[];
  kind: 'audioinput' | 'audiooutput';
  label: string;
  onChange: (kind: 'audioinput' | 'audiooutput', id: string) => void;
}) {
  return (
    <label>
      {label}
      <select defaultValue="" onChange={(e) => onChange(kind, e.target.value)}>
        <option value="" disabled>
          Choose device
        </option>
        {devices
          .filter((d) => d.kind === kind)
          .map((device, i) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `${label} ${i + 1}`}
            </option>
          ))}
      </select>
    </label>
  );
}
