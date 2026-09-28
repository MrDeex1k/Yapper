import { useEffect, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  RemoteTrackPublication,
  type LocalTrackPublication,
  type LocalVideoTrack,
  type RemoteVideoTrack,
} from 'livekit-client';
import { Button } from './ui/button';
type Entry = {
  id: string;
  label: string;
  publication: LocalTrackPublication | RemoteTrackPublication;
  track?: LocalVideoTrack | RemoteVideoTrack;
};
function publications(room: Room): Entry[] {
  const result: Entry[] = [];
  for (const participant of [room.localParticipant, ...room.remoteParticipants.values()]) {
    for (const publication of participant.videoTrackPublications.values()) {
      if (
        publication.source === Track.Source.ScreenShare ||
        publication.source === Track.Source.Camera
      )
        result.push({
          id: publication.trackSid,
          label: `${participant.name || participant.identity} · ${publication.source === Track.Source.ScreenShare ? 'screen' : 'camera'}`,
          publication,
          track: publication.track as LocalVideoTrack | RemoteVideoTrack | undefined,
        });
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}
export function VideoStage({ room }: { room: Room }) {
  const [entries, setEntries] = useState(() => publications(room));
  const [page, setPage] = useState(0);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const pages = Math.max(1, Math.ceil(entries.length / 4));
  const currentPage = Math.min(page, pages - 1);
  const offset = currentPage * 4;
  useEffect(() => {
    let active = true;
    const update = () =>
      queueMicrotask(() => {
        if (active) setEntries(publications(room));
      });
    room.on(RoomEvent.TrackPublished, update);
    room.on(RoomEvent.TrackUnpublished, update);
    room.on(RoomEvent.TrackSubscribed, update);
    room.on(RoomEvent.TrackUnsubscribed, update);
    room.on(RoomEvent.LocalTrackPublished, update);
    room.on(RoomEvent.LocalTrackUnpublished, update);
    room.on(RoomEvent.TrackMuted, update);
    room.on(RoomEvent.TrackUnmuted, update);
    room.on(RoomEvent.ParticipantDisconnected, update);
    return () => {
      active = false;
      room.off(RoomEvent.TrackPublished, update);
      room.off(RoomEvent.TrackUnpublished, update);
      room.off(RoomEvent.TrackSubscribed, update);
      room.off(RoomEvent.TrackUnsubscribed, update);
      room.off(RoomEvent.LocalTrackPublished, update);
      room.off(RoomEvent.LocalTrackUnpublished, update);
      room.off(RoomEvent.TrackMuted, update);
      room.off(RoomEvent.TrackUnmuted, update);
      room.off(RoomEvent.ParticipantDisconnected, update);
      for (const participant of room.remoteParticipants.values())
        for (const publication of participant.videoTrackPublications.values())
          publication.setSubscribed(false);
    };
  }, [room]);
  useEffect(() => {
    let intersecting = false;
    const update = () => setVisible(intersecting && document.visibilityState === 'visible');
    const observer = new IntersectionObserver((entries) => {
      intersecting = entries.some((entry) => entry.isIntersecting);
      update();
    });
    if (container.current) observer.observe(container.current);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  useEffect(() => {
    const selected = new Set(entries.slice(offset, offset + 4).map((entry) => entry.id));
    for (const entry of entries) {
      if (entry.publication instanceof RemoteTrackPublication) {
        const desired = visible && !paused && selected.has(entry.id);
        if (entry.publication.isDesired !== desired) entry.publication.setSubscribed(desired);
      }
    }
  }, [entries, offset, visible, paused]);
  return (
    <div ref={container}>
      <div className="media-controls">
        <Button variant="ghost" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>
          {paused ? 'Resume incoming video' : 'Pause incoming video'}
        </Button>
        {pages > 1 ? (
          <>
            <Button
              variant="ghost"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous videos
            </Button>
            <span>
              {currentPage + 1} / {pages}
            </span>
            <Button
              variant="ghost"
              disabled={currentPage === pages - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              Next videos
            </Button>
          </>
        ) : null}
      </div>
      <div className="video-grid">
        {entries.slice(offset, offset + 4).map((entry) =>
          entry.track &&
          !entry.publication.isMuted &&
          !(
            entry.publication instanceof RemoteTrackPublication &&
            (paused || !visible || !entry.publication.isSubscribed)
          ) ? (
            <VideoTile key={entry.id} entry={{ ...entry, track: entry.track }} />
          ) : (
            <figure className="video-tile" key={entry.id}>
              <div className="video-placeholder">
                {entry.publication.isMuted ? 'Camera paused' : 'Video paused or connecting'}
              </div>
              <figcaption>{entry.label}</figcaption>
            </figure>
          ),
        )}
      </div>
    </div>
  );
}
function VideoTile({ entry }: { entry: Entry & { track: LocalVideoTrack | RemoteVideoTrack } }) {
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
