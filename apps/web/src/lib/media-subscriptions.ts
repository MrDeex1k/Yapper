import type { Room } from 'livekit-client';
export function subscribeAudio(room: Room) {
  for (const participant of room.remoteParticipants.values()) {
    for (const publication of participant.audioTrackPublications.values()) {
      if (!publication.isDesired) publication.setSubscribed(true);
    }
  }
}
