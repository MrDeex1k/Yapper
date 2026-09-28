import { useEffect, useState } from 'react';
import { ConnectionQuality, Room, RoomEvent, type Participant } from 'livekit-client';
export function ConnectionQualityNotice({ room }: { room: Room }) {
  const [quality, setQuality] = useState(room.localParticipant.connectionQuality);
  useEffect(() => {
    const update = (quality: ConnectionQuality, participant: Participant) => {
      if (participant.identity === room.localParticipant.identity) setQuality(quality);
    };
    room.on(RoomEvent.ConnectionQualityChanged, update);
    return () => {
      room.off(RoomEvent.ConnectionQualityChanged, update);
    };
  }, [room]);
  return (
    <output className="connection-quality">
      {quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost
        ? 'Connection is weak. Pause incoming video or stop camera/screen sharing to reduce traffic.'
        : `Connection quality: ${quality}`}
    </output>
  );
}
