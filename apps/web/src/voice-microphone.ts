import { LocalAudioTrack, Track, type Room } from "livekit-client";

export type MicrophoneError = "microphoneDenied" | "microphoneMissing" | "microphoneFailed";

function microphoneError(error: unknown): MicrophoneError {
  if (error instanceof Error) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError")
      return "microphoneDenied";
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError")
      return "microphoneMissing";
  }
  return "microphoneFailed";
}

// The app owns capture so permission prompts and device changes cannot unmute an
// SDK-managed track after the user released push-to-talk or left the room.
export function createMicrophone(
  room: Room,
  onMuted: (muted: boolean) => void,
  onError: (error: MicrophoneError) => void,
) {
  let track: LocalAudioTrack | null = null;
  let operations = Promise.resolve();
  let generation = 0;

  function quiet() {
    if (track) track.mediaStreamTrack.enabled = false;
    onMuted(true);
  }

  async function removeTrack() {
    const previous = track;
    track = null;
    if (!previous) return;
    previous.stop();
    await room.localParticipant.unpublishTrack(previous);
  }

  async function capture(input: string, current: () => boolean) {
    const constraints: MediaTrackConstraints = {
      echoCancellation: true,
      autoGainControl: true,
      noiseSuppression: true,
      ...(input !== "default" ? { deviceId: { exact: input } } : {}),
    };
    const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    const raw = stream.getAudioTracks()[0];
    if (!raw || !current()) {
      for (const item of stream.getTracks()) item.stop();
      if (!raw) throw new DOMException("audio input unavailable", "NotFoundError");
      return;
    }
    raw.enabled = false;
    const next = new LocalAudioTrack(raw, constraints, true);
    try {
      await next.mute();
      if (!current()) {
        next.stop();
        return;
      }
      track = next;
      raw.addEventListener(
        "ended",
        () => {
          if (track !== next) return;
          ++generation;
          quiet();
          onError("microphoneMissing");
        },
        { once: true },
      );
      await room.localParticipant.publishTrack(next, { source: Track.Source.Microphone });
    } catch (e) {
      if (track === next) track = null;
      next.stop();
      throw e;
    }
  }

  function setEnabled(enabled: boolean, inputDeviceId: string) {
    const version = ++generation;
    const current = () => generation === version;
    if (!enabled) quiet();
    operations = operations
      .then(async () => {
        if (!current()) return;
        if (!enabled) {
          await track?.mute();
          return;
        }
        if (track?.mediaStreamTrack.readyState === "ended") await removeTrack();
        if (!track) await capture(inputDeviceId, current);
        if (!current() || !track) return;
        await track.unmute();
        if (current()) onMuted(false);
        else {
          quiet();
          await track.mute();
        }
      })
      .catch((e) => {
        if (current()) {
          quiet();
          onError(microphoneError(e));
        }
      });
    return operations;
  }

  function reset() {
    ++generation;
    quiet();
    operations = operations.then(removeTrack).catch(() => {});
    return operations;
  }

  return {
    setEnabled,
    reset,
    stop() {
      ++generation;
      quiet();
      track?.stop();
    },
  };
}
