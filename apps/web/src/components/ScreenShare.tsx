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
          resolution: { width: 1280, height: 720, frameRate: 15 },
          systemAudio: 'exclude',
        },
        { videoCodec: 'vp8', screenShareEncoding: { maxBitrate: 1500000, maxFramerate: 15 } },
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
