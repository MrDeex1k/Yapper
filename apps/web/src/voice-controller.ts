import {
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteAudioTrack,
} from "livekit-client";
import type { VoiceGrant } from "@yapper/api";
import { APIError, request } from "./api";
import { createMicrophone, type MicrophoneError } from "./voice-microphone";

export type AudioDeviceKind = "audioinput" | "audiooutput";
export type VoiceError =
  | MicrophoneError
  | "voiceError"
  | "voiceDisconnected"
  | "voiceAccessDenied"
  | "voiceDeviceError"
  | "voicePlaybackError"
  | "voiceOutputDenied";
type VoiceStatus = "disconnected" | "connecting" | "connected" | "reconnecting";
type VoiceParticipant = {
  identity: string;
  name: string;
  speaking: boolean;
  local: boolean;
  volume: number;
};
type VoiceState = {
  status: VoiceStatus;
  channel: string | null;
  retryChannel: string | null;
  muted: boolean;
  canPublish: boolean;
  deafened: boolean;
  pushToTalk: boolean;
  error: VoiceError | false;
  audioBlocked: boolean;
  participants: VoiceParticipant[];
  devices: MediaDeviceInfo[];
  input: string;
  output: string;
  supportsOutput: boolean;
  supportsOutputPicker: boolean;
};
type LiveSession = {
  room: Room;
  grant: VoiceGrant;
  microphone: ReturnType<typeof createMicrophone>;
  audio: Map<RemoteAudioTrack, HTMLMediaElement | null>;
  joined: boolean;
  stopPromise?: Promise<void>;
};
function attachAudio(track: RemoteAudioTrack) {
  const element = document.createElement("audio");
  element.className = "remote-audio";
  track.attach(element);
  document.body.append(element);
  return element;
}

function detachAudio(track: RemoteAudioTrack, element: HTMLMediaElement) {
  element.muted = true;
  track.detach(element);
  element.remove();
}

type OutputPicker = MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };
const defaultDevice = "default";

export const initialVoiceState: VoiceState = {
  status: "disconnected",
  channel: null,
  retryChannel: null,
  muted: true,
  canPublish: false,
  deafened: false,
  pushToTalk: false,
  error: false,
  audioBlocked: false,
  participants: [],
  devices: [],
  input: defaultDevice,
  output: defaultDevice,
  supportsOutput: false,
  supportsOutputPicker: false,
};

const recoverable = new Set([
  DisconnectReason.SIGNAL_CLOSE,
  DisconnectReason.STATE_MISMATCH,
  DisconnectReason.CONNECTION_TIMEOUT,
  DisconnectReason.MEDIA_FAILURE,
  DisconnectReason.SERVER_SHUTDOWN,
  DisconnectReason.UNKNOWN_REASON,
]);
function participantIdFromMediaIdentity(mediaIdentity: string) {
  return mediaIdentity.split(":", 1)[0] ?? mediaIdentity;
}

export function createVoiceController(onState: (next: VoiceState) => void) {
  let state = initialVoiceState;
  let active: LiveSession | null = null;
  let generation = 0;
  let operations = Promise.resolve();
  let deviceOperations = Promise.resolve();
  let devicesRevision = 0;
  let disposed = false;
  let forcedMuted = false;
  let continuous = false;
  let pushToTalkHeld = false;
  const volumes = new Map<string, number>();

  function publish(patch: Partial<VoiceState>) {
    state = { ...state, ...patch };
    if (!disposed) onState(state);
  }

  function isCurrentSession(session: LiveSession) {
    return active === session && !session.stopPromise && !disposed;
  }

  function syncMic() {
    if (!active || !isCurrentSession(active)) return;
    const wanted =
      state.status === "connected" &&
      state.canPublish &&
      !forcedMuted &&
      !state.deafened &&
      (state.pushToTalk ? pushToTalkHeld : continuous);
    void active.microphone.setEnabled(wanted, state.input);
  }

  function setPushToTalkHeld(held: boolean) {
    if (pushToTalkHeld === held) return;
    pushToTalkHeld = held;
    if (held) publish({ error: false });
    syncMic();
  }

  async function release(identity: string) {
    try {
      await request("/api/v1/voice/leave", { identity });
    } catch {
      // A replacement grant invalidates the prior identity even if its leave was lost.
    }
  }

  function stop(session: LiveSession) {
    if (!session.stopPromise) {
      // Schedule only once and fence off room events before it begins.
      session.stopPromise = Promise.resolve()
        .then(async () => {
          session.microphone.stop();
          for (const [track, element] of session.audio) {
            if (element) detachAudio(track, element);
          }
          session.audio.clear();
          await session.room.disconnect();
        })
        .catch(() => {});
    }
    return session.stopPromise;
  }

  async function open(version: number, channel: string | null, resumeIdentity?: string) {
    if (active) {
      const previous = active;
      active = null;
      await stop(previous);
      if (previous.grant.identity !== resumeIdentity) await release(previous.grant.identity);
    }
    if (!channel || generation !== version || disposed) {
      if (resumeIdentity) await release(resumeIdentity);
      return;
    }
    let grant: VoiceGrant;
    try {
      const body = { channelId: channel, ...(resumeIdentity ? { resumeIdentity } : {}) };
      const requestGrant = () => request<VoiceGrant>("/api/v1/voice/grant", body);
      try {
        grant = await requestGrant();
      } catch (error) {
        if (
          !resumeIdentity ||
          generation !== version ||
          disposed ||
          !(error instanceof APIError && error.status >= 500)
        )
          throw error;
        grant = await requestGrant();
      }
    } catch (e) {
      if (resumeIdentity) await release(resumeIdentity);
      throw e;
    }
    if (generation !== version || disposed) {
      await release(grant.identity);
      return;
    }
    const room = new Room({
      adaptiveStream: false,
      dynacast: false,
      ...(state.supportsOutput && state.output !== defaultDevice
        ? { audioOutput: { deviceId: state.output } }
        : {}),
    });
    const microphone = createMicrophone(
      room,
      (muted) => {
        if (!isCurrentSession(session)) return;
        publish({ muted });
        if (!muted && state.devices.every((device) => !device.label)) void refreshDevices();
      },
      (error) => {
        if (!isCurrentSession(session)) return;
        continuous = false;
        pushToTalkHeld = false;
        publish({ error, muted: true });
        void refreshDevices();
      },
    );
    const session: LiveSession = {
      room,
      grant,
      microphone,
      audio: new Map(),
      joined: false,
    };
    active = session;
    attachRoomEvents(session, Boolean(resumeIdentity));
    // A grant can be subscribe-only after an owner or moderator forced mute.
    publish({ canPublish: grant.canPublish });
    try {
      await room.connect(grant.url, grant.token);
      if (!isCurrentSession(session)) return;
      session.joined = true;
      publish({ status: "connected" });
      updateParticipants(session);
      void refreshDevices();
      void startAudio();
    } catch (e) {
      if (!isCurrentSession(session)) return;
      active = null;
      await stop(session);
      await release(grant.identity);
      throw e;
    }
  }

  function select(channel: string | null, resumeIdentity?: string) {
    const version = ++generation;
    pushToTalkHeld = false;
    continuous = false;
    if (active) void stop(active);
    publish({
      channel,
      status: channel ? (resumeIdentity ? "reconnecting" : "connecting") : "disconnected",
      retryChannel: null,
      error: false,
      muted: true,
      canPublish: false,
      audioBlocked: false,
      participants: [],
    });
    operations = operations
      .then(() => open(version, channel, resumeIdentity))
      .catch((e) => {
        if (generation !== version) return;
        publish({
          channel: null,
          status: "disconnected",
          muted: true,
          canPublish: false,
          error: e instanceof APIError && e.status === 403 ? "voiceAccessDenied" : "voiceError",
          retryChannel: channel,
        });
      });
    return operations;
  }

  function updateParticipants(session: LiveSession) {
    if (!isCurrentSession(session)) return;
    const { room } = session;
    function view(participant: Participant, local: boolean): VoiceParticipant {
      return {
        identity: participant.identity,
        name: participant.name || participant.identity,
        speaking: participant.isSpeaking,
        local,
        volume: volumes.get(participantIdFromMediaIdentity(participant.identity)) ?? 1,
      };
    }
    publish({
      participants: [
        view(room.localParticipant, true),
        ...[...room.remoteParticipants.values()].map((participant) => view(participant, false)),
      ],
    });
  }

  function attachRoomEvents(session: LiveSession, recovery: boolean) {
    const { room } = session;
    function update() {
      updateParticipants(session);
    }
    room
      .on(RoomEvent.ParticipantConnected, update)
      .on(RoomEvent.ParticipantDisconnected, update)
      .on(RoomEvent.ActiveSpeakersChanged, update)
      .on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (!isCurrentSession(session) || track.kind !== Track.Kind.Audio) return;
        const audio = track as RemoteAudioTrack;
        if (session.audio.has(audio)) return;
        participant.setVolume(
          volumes.get(participantIdFromMediaIdentity(participant.identity)) ?? 1,
        );
        session.audio.set(audio, state.deafened ? null : attachAudio(audio));
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        const audio = track as RemoteAudioTrack;
        const element = session.audio.get(audio);
        if (element) detachAudio(audio, element);
        session.audio.delete(audio);
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (isCurrentSession(session)) publish({ audioBlocked: !room.canPlaybackAudio });
      })
      .on(RoomEvent.ConnectionStateChanged, (status) => {
        if (!isCurrentSession(session) || !session.joined) return;
        if (
          status === ConnectionState.Reconnecting ||
          status === ConnectionState.SignalReconnecting
        ) {
          pushToTalkHeld = false;
          continuous = false;
          publish({ status: "reconnecting" });
          syncMic();
        } else if (status === ConnectionState.Connected) {
          publish({ status: "connected" });
          update();
        }
      })
      .on(RoomEvent.Disconnected, (reason) => {
        if (!isCurrentSession(session) || !session.joined) return;
        const { channelId } = session.grant;
        if (!recovery && reason !== undefined && recoverable.has(reason)) {
          void select(channelId, session.grant.identity);
        } else {
          void select(null);
          publish({ error: "voiceDisconnected", retryChannel: channelId });
        }
      });
  }

  async function refreshDevices() {
    if (!navigator.mediaDevices) return;
    const version = ++devicesRevision;
    try {
      const devices = (await Room.getLocalDevices(undefined, false)).filter(
        (device) =>
          device.kind !== "videoinput" && device.deviceId && device.deviceId !== defaultDevice,
      );
      if (version !== devicesRevision || disposed) return;
      publish({ devices });
    } catch {
      // Unavailable device lists leave the system defaults usable.
    }
  }

  function setDevice(kind: AudioDeviceKind, id: string) {
    const session = active;
    if (!session || !isCurrentSession(session)) return Promise.resolve();
    deviceOperations = deviceOperations
      .then(async () => {
        if (!isCurrentSession(session)) return;
        publish({ error: false });
        if (kind === "audioinput") {
          pushToTalkHeld = false;
          continuous = false;
          publish({ input: id });
          await session.microphone.reset();
        } else {
          const success = await session.room.switchActiveDevice(
            kind,
            id === defaultDevice ? "" : id,
          );
          if (!success) throw new Error("audio output unavailable");
          if (isCurrentSession(session)) publish({ output: id });
        }
      })
      .catch(() => {
        if (isCurrentSession(session)) publish({ error: "voiceDeviceError" });
      });
    return deviceOperations;
  }

  async function startAudio() {
    const session = active;
    if (!session || !isCurrentSession(session) || state.deafened) return;
    try {
      await session.room.startAudio();
      if (isCurrentSession(session)) {
        publish({ audioBlocked: !session.room.canPlaybackAudio });
      }
    } catch {
      if (isCurrentSession(session)) publish({ audioBlocked: true, error: "voicePlaybackError" });
    }
  }

  const devices = navigator.mediaDevices as OutputPicker | undefined;
  const supportsOutput =
    typeof HTMLMediaElement !== "undefined" &&
    typeof HTMLMediaElement.prototype.setSinkId === "function";
  publish({
    supportsOutput,
    supportsOutputPicker: supportsOutput && typeof devices?.selectAudioOutput === "function",
  });
  devices?.addEventListener("devicechange", refreshDevices);

  return {
    join(channel: string) {
      return state.channel === channel ? operations : select(channel);
    },
    leave: () => select(null),
    dispose() {
      disposed = true;
      devices?.removeEventListener("devicechange", refreshDevices);
      void select(null);
    },
    setForcedMuted(value: boolean) {
      if (forcedMuted === value) return;
      forcedMuted = value;
      if (value) {
        continuous = false;
        pushToTalkHeld = false;
      }
      syncMic();
    },
    toggleMute() {
      if (
        state.pushToTalk ||
        state.deafened ||
        forcedMuted ||
        !state.canPublish ||
        state.status !== "connected"
      )
        return;
      continuous = !continuous;
      publish({ error: false });
      syncMic();
      if (continuous) void refreshDevices();
    },
    toggleDeafen() {
      const deafened = !state.deafened;
      if (deafened) {
        continuous = false;
        pushToTalkHeld = false;
      }
      publish({ deafened });
      syncMic();
      if (active) {
        // LiveKit can restart attached audio on iOS without emitting a playback status change.
        for (const [track, element] of active.audio) {
          if (deafened && element) {
            detachAudio(track, element);
            active.audio.set(track, null);
          } else if (!deafened && !element) {
            active.audio.set(track, attachAudio(track));
          }
        }
      }
      if (!deafened) void startAudio();
    },
    setPushToTalk(enabled: boolean) {
      continuous = false;
      pushToTalkHeld = false;
      publish({ pushToTalk: enabled });
      syncMic();
    },
    setPushToTalkHeld,
    setVolume(identity: string, volume: number) {
      const session = active;
      const participant = session?.room.remoteParticipants.get(identity);
      if (!session || !participant || !isCurrentSession(session)) return;
      volumes.set(participantIdFromMediaIdentity(identity), volume);
      participant.setVolume(volume);
      updateParticipants(session);
    },
    setDevice,
    refreshDevices,
    async pickOutput() {
      try {
        const device = await devices?.selectAudioOutput?.();
        if (!device) return;
        await refreshDevices();
        await setDevice("audiooutput", device.deviceId);
      } catch (e) {
        if (e instanceof Error && e.name === "NotAllowedError")
          publish({ error: "voiceOutputDenied" });
        else publish({ error: "voiceDeviceError" });
      }
    },
    startAudio,
  };
}
