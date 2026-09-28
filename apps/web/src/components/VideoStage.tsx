import { useEffect, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  type LocalVideoTrack,
  type RemoteVideoTrack,
} from 'livekit-client';
type Entry = { id: string; label: string; track: LocalVideoTrack | RemoteVideoTrack };
function tracks(room: Room): Entry[] {
  const result: Entry[] = [];
  for (const participant of [room.localParticipant, ...room.remoteParticipants.values()]) {
    for (const publication of participant.videoTrackPublications.values()) {
      if (
        (publication.source === Track.Source.ScreenShare ||
          publication.source === Track.Source.Camera) &&
        publication.track &&
        !publication.isMuted
      )
        result.push({
          id: publication.trackSid,
          label: `${participant.name || participant.identity} · ${publication.source === Track.Source.ScreenShare ? 'screen' : 'camera'}`,
          track: publication.track as LocalVideoTrack | RemoteVideoTrack,
        });
    }
  }
  return result;
}
export function VideoStage({ room }: { room: Room }) {
  const [entries, setEntries] = useState(() => tracks(room));
  useEffect(() => {
    const update = () => setEntries(tracks(room));
    room.on(RoomEvent.TrackSubscribed, update);
    room.on(RoomEvent.TrackUnsubscribed, update);
    room.on(RoomEvent.LocalTrackPublished, update);
    room.on(RoomEvent.LocalTrackUnpublished, update);
    room.on(RoomEvent.TrackMuted, update);
    room.on(RoomEvent.TrackUnmuted, update);
    room.on(RoomEvent.ParticipantDisconnected, update);
    return () => {
      room.off(RoomEvent.TrackSubscribed, update);
      room.off(RoomEvent.TrackUnsubscribed, update);
      room.off(RoomEvent.LocalTrackPublished, update);
      room.off(RoomEvent.LocalTrackUnpublished, update);
      room.off(RoomEvent.TrackMuted, update);
      room.off(RoomEvent.TrackUnmuted, update);
      room.off(RoomEvent.ParticipantDisconnected, update);
    };
  }, [room]);
  return (
    <div className="video-grid">
      {entries.map((entry) => (
        <VideoTile key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
function VideoTile({ entry }: { entry: Entry }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    entry.track.attach(element);
    return () => {
      entry.track.detach(element);
    };
  }, [entry.track]);
  return (
    <figure className="video-tile">
      <video ref={video} autoPlay playsInline muted aria-label={entry.label} />
      <figcaption>{entry.label}</figcaption>
    </figure>
  );
}
