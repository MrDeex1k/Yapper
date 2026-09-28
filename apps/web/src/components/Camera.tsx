import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import { errorMessage } from '../lib/api';
import { Button } from './ui/button';
export function Camera({
  room,
  allowed,
  onError,
}: {
  room: Room;
  allowed: boolean;
  onError: (message: string) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState('');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const update = () => setEnabled(room.localParticipant.isCameraEnabled);
    const refresh = () => {
      void Room.getLocalDevices('videoinput', false)
        .then((devices) => {
          if (active.current) setDevices(devices);
        })
        .catch((e) => {
          if (active.current) onError(errorMessage(e));
        });
    };
    refresh();
    room.on(RoomEvent.LocalTrackPublished, update);
    room.on(RoomEvent.LocalTrackUnpublished, update);
    room.on(RoomEvent.TrackMuted, update);
    room.on(RoomEvent.TrackUnmuted, update);
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      active.current = false;
      room.off(RoomEvent.LocalTrackPublished, update);
      room.off(RoomEvent.LocalTrackUnpublished, update);
      room.off(RoomEvent.TrackMuted, update);
      room.off(RoomEvent.TrackUnmuted, update);
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, [room, onError]);
  async function toggle() {
    setBusy(true);
    try {
      await room.localParticipant.setCameraEnabled(
        !room.localParticipant.isCameraEnabled,
        { deviceId: device || undefined, resolution: { width: 1280, height: 720, frameRate: 24 } },
        {
          videoCodec: 'vp8',
          simulcast: true,
          videoEncoding: { maxBitrate: 1200000, maxFramerate: 24 },
        },
      );
      if (!active.current) {
        await room.localParticipant.setCameraEnabled(false);
        return;
      }
      setEnabled(room.localParticipant.isCameraEnabled);
    } catch (e) {
      if (active.current) onError(errorMessage(e));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function select(id: string) {
    try {
      if (enabled) await room.switchActiveDevice('videoinput', id);
      setDevice(id);
    } catch (e) {
      onError(errorMessage(e));
    }
  }
  return (
    <div className="media-controls">
      <Button variant="outline" aria-pressed={enabled} disabled={!allowed || busy} onClick={toggle}>
        {enabled ? 'Turn camera off' : 'Turn camera on'}
      </Button>
      <label>
        Camera device
        <select
          value={device}
          disabled={!allowed || busy}
          onChange={(e) => void select(e.target.value)}
        >
          <option value="">Default camera</option>
          {devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Camera ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
      {!allowed ? <small>Camera publishing is disabled by the host.</small> : null}
    </div>
  );
}
