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
  audio: Map<RemoteAudioTrack, HTMLMediaElement>;
  joined: boolean;
  stopped?: Promise<void>;
};
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
function memberKey(identity: string) {
  return identity.split(":", 1)[0] ?? identity;
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
  let held = false;
  const volumes = new Map<string, number>();

  function publish(patch: Partial<VoiceState>) {
    state = { ...state, ...patch };
    if (!disposed) onState(state);
  }

  function current(session: LiveSession) {
    return active === session && !session.stopped && !disposed;
  }

  function syncMic() {
    if (!active || !current(active)) return;
    const wanted =
      state.status === "connected" &&
      state.canPublish &&
      !forcedMuted &&
      !state.deafened &&
      (state.pushToTalk ? held : continuous);
    void active.microphone.enable(wanted, state.input);
  }

  function press(value: boolean) {
    if (held === value) return;
    held = value;
    if (value) publish({ error: false });
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
    if (!session.stopped) {
      // Schedule only once and fence off room events before it begins.
      session.stopped = Promise.resolve()
        .then(async () => {
          session.microphone.stop();
          for (const [track, element] of session.audio) {
            track.detach(element);
            element.remove();
          }
          session.audio.clear();
          await session.room.disconnect();
        })
        .catch(() => {});
    }
    return session.stopped;
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
        if (!current(session)) return;
        publish({ muted });
        if (!muted && state.devices.every((device) => !device.label)) void refreshDevices();
      },
      (error) => {
        if (!current(session)) return;
        continuous = false;
        held = false;
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
      if (!current(session)) return;
      session.joined = true;
      publish({ status: "connected" });
      updateParticipants(session);
      void refreshDevices();
      void startAudio();
    } catch (e) {
      if (!current(session)) return;
      active = null;
      await stop(session);
      await release(grant.identity);
      throw e;
    }
  }

  function select(channel: string | null, resumeIdentity?: string) {
    const version = ++generation;
    held = false;
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
    if (!current(session)) return;
    const { room } = session;
    function view(participant: Participant, local: boolean): VoiceParticipant {
      return {
        identity: participant.identity,
        name: participant.name || participant.identity,
        speaking: participant.isSpeaking,
        local,
        volume: volumes.get(memberKey(participant.identity)) ?? 1,
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
        if (!current(session) || track.kind !== Track.Kind.Audio) return;
        const audio = track as RemoteAudioTrack;
        if (session.audio.has(audio)) return;
        const element = audio.attach();
        element.className = "remote-audio";
        element.muted = state.deafened;
        participant.setVolume(volumes.get(memberKey(participant.identity)) ?? 1);
        document.body.append(element);
        session.audio.set(audio, element);
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        const audio = track as RemoteAudioTrack;
        const element = session.audio.get(audio);
        if (!element) return;
        audio.detach(element);
        element.remove();
        session.audio.delete(audio);
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (current(session)) publish({ audioBlocked: !room.canPlaybackAudio });
      })
      .on(RoomEvent.ConnectionStateChanged, (status) => {
        if (!current(session) || !session.joined) return;
        if (
          status === ConnectionState.Reconnecting ||
          status === ConnectionState.SignalReconnecting
        ) {
          held = false;
          continuous = false;
          publish({ status: "reconnecting" });
          syncMic();
        } else if (status === ConnectionState.Connected) {
          publish({ status: "connected" });
          update();
        }
      })
      .on(RoomEvent.Disconnected, (reason) => {
        if (!current(session) || !session.joined) return;
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
    if (!session || !current(session)) return Promise.resolve();
    deviceOperations = deviceOperations
      .then(async () => {
        if (!current(session)) return;
        publish({ error: false });
        if (kind === "audioinput") {
          held = false;
          continuous = false;
          publish({ input: id });
          await session.microphone.reset();
        } else {
          const success = await session.room.switchActiveDevice(
            kind,
            id === defaultDevice ? "" : id,
          );
          if (!success) throw new Error("audio output unavailable");
          if (current(session)) publish({ output: id });
        }
      })
      .catch(() => {
        if (current(session)) publish({ error: "voiceDeviceError" });
      });
    return deviceOperations;
  }

  async function startAudio() {
    const session = active;
    if (!session || !current(session) || state.deafened) return;
    try {
      await session.room.startAudio();
      if (current(session)) {
        publish({ audioBlocked: !session.room.canPlaybackAudio });
      }
    } catch {
      if (current(session)) publish({ audioBlocked: true, error: "voicePlaybackError" });
    } finally {
      if (current(session) && state.deafened) {
        for (const element of session.audio.values()) element.muted = true;
      }
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
        held = false;
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
        held = false;
      }
      publish({ deafened });
      syncMic();
      if (active) for (const element of active.audio.values()) element.muted = deafened;
      if (!deafened) void startAudio();
    },
    setPushToTalk(enabled: boolean) {
      continuous = false;
      held = false;
      publish({ pushToTalk: enabled });
      syncMic();
    },
    press,
    setVolume(identity: string, volume: number) {
      const session = active;
      const participant = session?.room.remoteParticipants.get(identity);
      if (!session || !participant || !current(session)) return;
      volumes.set(memberKey(identity), volume);
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
