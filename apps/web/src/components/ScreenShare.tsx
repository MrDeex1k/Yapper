import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import { errorMessage } from '../lib/api';
import { Button } from './ui/button';
export function ScreenShare({
  room,
  allowed,
  onError,
}: {
  room: Room;
  allowed: boolean;
  onError: (message: string) => void;
}) {
  const [quality, setQuality] = useState('standard');
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const update = () => setSharing(room.localParticipant.isScreenShareEnabled);
    room.on(RoomEvent.LocalTrackPublished, update);
    room.on(RoomEvent.LocalTrackUnpublished, update);
    return () => {
      active.current = false;
      room.off(RoomEvent.LocalTrackPublished, update);
      room.off(RoomEvent.LocalTrackUnpublished, update);
    };
  }, [room]);
  async function toggle() {
    setBusy(true);
    try {
      await room.localParticipant.setScreenShareEnabled(
        !room.localParticipant.isScreenShareEnabled,
        {
          audio: false,
          resolution:
            quality === 'economy'
              ? { width: 854, height: 480, frameRate: 10 }
              : { width: 1280, height: 720, frameRate: 15 },
          systemAudio: 'exclude',
        },
        {
          videoCodec: 'vp8',
          screenShareEncoding:
            quality === 'economy'
              ? { maxBitrate: 500000, maxFramerate: 10 }
              : { maxBitrate: 1500000, maxFramerate: 15 },
        },
      );
      if (!active.current) {
        await room.localParticipant.setScreenShareEnabled(false);
        return;
      }
      setSharing(room.localParticipant.isScreenShareEnabled);
    } catch (e) {
      if (active.current) onError(errorMessage(e));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <div className="media-controls">
      <label>
        Screen quality
        <select
          value={quality}
          disabled={sharing || busy}
          onChange={(e) => setQuality(e.target.value)}
        >
          <option value="economy">Economy · 480p / 10 fps</option>
          <option value="standard">Standard · 720p / 15 fps</option>
        </select>
      </label>
      <Button variant="outline" disabled={!allowed || busy} aria-pressed={sharing} onClick={toggle}>
        {sharing ? 'Stop sharing' : 'Share screen'}
      </Button>
      <small>
        {allowed
          ? 'Choose a source. Screen audio is disabled in this candidate.'
          : 'Screen sharing is disabled by the host.'}
      </small>
    </div>
  );
}
