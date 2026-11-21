import { test, expect, mock } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
const browser = new Window({ url: "http://localhost:5173" });
Object.assign(globalThis, {
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  Element: browser.Element,
  HTMLMediaElement: browser.HTMLMediaElement,
  location: browser.location,
  IS_REACT_ACT_ENVIRONMENT: true,
});
let waitForConnect: (() => Promise<void>) | undefined;
let voiceRequests: string[] = [];
let grantNumber = 0;
let activeRooms = new Set<TestRoom>();
let peakRooms = 0;
let canPublish = true;
const publications: boolean[] = [];
class RawMicrophone extends EventTarget {
  enabled = true;
  readyState = "live";
  stop() {
    this.enabled = false;
    this.readyState = "ended";
  }
}
class TestAudioTrack {
  constructor(readonly mediaStreamTrack: RawMicrophone) {}
  stop() {
    this.mediaStreamTrack.stop();
  }
  async mute() {
    this.mediaStreamTrack.enabled = false;
  }
  async unmute() {
    this.mediaStreamTrack.enabled = true;
  }
}
let capture = async (_options: MediaStreamConstraints) => mockStream(new RawMicrophone());
function mockStream(raw: RawMicrophone) {
  return { getAudioTracks: () => [raw], getTracks: () => [raw] };
}
const deviceEvents = new EventTarget();
Object.defineProperty(browser.navigator, "mediaDevices", {
  get: () => deviceEvents,
});
Object.assign(deviceEvents, {
  getUserMedia: (options: MediaStreamConstraints) => capture(options),
});
class TestRoom {
  static latest: TestRoom;
  localParticipant = {
    identity: "guest",
    name: "guest",
    isSpeaking: false,
    publishTrack: async (track: TestAudioTrack) => {
      publications.push(track.mediaStreamTrack.enabled);
    },
    unpublishTrack: async () => {},
  };
  remoteParticipants = new Map<
    string,
    { identity: string; name: string; isSpeaking: boolean; setVolume: (value: number) => void }
  >();
  canPlaybackAudio = true;
  listeners = new Map<string, (...args: unknown[]) => void>();
  cancel = Promise.withResolvers<void>();
  constructor() {
    TestRoom.latest = this;
  }
  static async getLocalDevices() {
    return [];
  }
  on(event: string, cb: (...args: unknown[]) => void) {
    this.listeners.set(event, cb);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.(...args);
  }
  async connect() {
    activeRooms.add(this);
    peakRooms = Math.max(peakRooms, activeRooms.size);
    if (waitForConnect) await Promise.race([waitForConnect(), this.cancel.promise]);
  }
  async disconnect() {
    activeRooms.delete(this);
    this.cancel.resolve();
    this.emit("Disconnected", 1);
  }
  async startAudio() {}
  async switchActiveDevice(kind: string, id: string) {
    voiceRequests.push(`device:${kind}:${id}`);
    return true;
  }
}
const roomEvents = Object.fromEntries(
  [
    "ParticipantConnected",
    "ParticipantDisconnected",
    "ActiveSpeakersChanged",
    "TrackSubscribed",
    "TrackUnsubscribed",
    "AudioPlaybackStatusChanged",
    "ConnectionStateChanged",
    "Disconnected",
  ].map((name) => [name, name]),
);
mock.module("livekit-client", () => ({
  Room: TestRoom,
  RoomEvent: roomEvents,
  LocalAudioTrack: TestAudioTrack,
  Track: { Kind: { Audio: "audio" }, Source: { Microphone: "microphone" } },
  ConnectionState: {
    Connected: "connected",
    Reconnecting: "reconnecting",
    SignalReconnecting: "signal",
  },
  DisconnectReason: {
    UNKNOWN_REASON: 0,
    SERVER_SHUTDOWN: 3,
    PARTICIPANT_REMOVED: 4,
    STATE_MISMATCH: 6,
    SIGNAL_CLOSE: 9,
    CONNECTION_TIMEOUT: 14,
    MEDIA_FAILURE: 15,
  },
}));
class TestSocket {
  static last: TestSocket;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number }) => void;
  constructor() {
    TestSocket.last = this;
  }
  emit(type: string, payload?: { channelId: string }) {
    this.onmessage?.({ data: JSON.stringify({ type, payload }) });
  }
  close() {}
}
Object.assign(globalThis, { WebSocket: TestSocket });
const sample = {
  id: "first",
  authorId: "guest",
  nickname: "guest",
  channelId: "a",
  requestId: "request",
  sequence: 1,
  body: "before",
  createdAt: new Date().toISOString(),
  revision: 1,
};
const calls: string[] = [];
let changes: { id: string; revision: number; message: typeof sample | null }[] = [];
mock.module("../src/api", () => ({
  api: {
    ticket: async () => ({ ticket: "ticket" }),
    timeline: async (channel: string) => ({
      messages: [{ ...sample, channelId: channel }],
      before: 0,
      revision: 1,
    }),
    messageChanges: async (channel: string, revision: number) => {
      calls.push(channel);
      return { changes: changes.filter((change) => change.revision > revision) };
    },
  },
  APIError: class extends Error {},
  request: async (
    path: string,
    input: { channelId?: string; identity?: string; resumeIdentity?: string },
  ) => {
    if (path.endsWith("grant")) {
      const identity = `guest:${input.channelId}:${++grantNumber}`;
      voiceRequests.push(
        `grant:${identity}${input.resumeIdentity ? `/resume:${input.resumeIdentity}` : ""}`,
      );
      return {
        identity,
        channelId: input.channelId,
        token: "test",
        url: "ws://localhost",
        canPublish,
      };
    }
    voiceRequests.push(`leave:${input.identity}`);
    return { left: true };
  },
}));
const refreshCommunity = async () => {};
const { useConversation } = await import("../src/use-conversation");
const { useVoice } = await import("../src/use-voice");
const { createVoiceController } = await import("../src/voice-controller");

test("chat applies durable edits and reconnect deletions, ignoring a stale channel refresh", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  let conversation!: ReturnType<typeof useConversation>;
  function Harness({ channel }: { channel: string }) {
    const value = useConversation(channel, refreshCommunity);
    useLayoutEffect(() => {
      conversation = value;
    });
    return null;
  }
  try {
    await act(async () => root.render(createElement(Harness, { channel: "a" })));
    await act(async () => TestSocket.last.emit("ready"));
    expect(conversation.messages.map((message) => message.body)).toEqual(["before"]);
    changes = [{ id: sample.id, revision: 2, message: { ...sample, body: "after", revision: 2 } }];
    await act(async () => TestSocket.last.emit("messages.changed", { channelId: "a" }));
    expect(conversation.messages.map((message) => message.body)).toEqual(["after"]);
    changes = [{ id: sample.id, revision: 3, message: null }];
    await act(async () => TestSocket.last.emit("ready"));
    expect(conversation.messages).toHaveLength(0);
    const refresh = conversation.refresh;
    changes = [];
    await act(async () => root.render(createElement(Harness, { channel: "b" })));
    await act(async () => TestSocket.last.emit("ready"));
    calls.length = 0;
    await act(async () => refresh("a"));
    expect(calls).toEqual([]);
    expect(conversation.messages.map((message) => message.channelId)).toEqual(["b"]);
  } finally {
    await act(async () => root.unmount());
  }
});

test("leaving during voice connection does not display a connection error", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  let voice!: ReturnType<typeof useVoice>;
  function Harness() {
    const value = useVoice();
    useLayoutEffect(() => {
      voice = value;
    });
    return null;
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    const entered = Promise.withResolvers<void>();
    waitForConnect = () => {
      entered.resolve();
      return new Promise<void>(() => {});
    };
    let joining!: Promise<void>;
    await act(async () => {
      joining = voice.join("voice");
      await entered.promise;
    });
    await act(async () => {
      await voice.leave();
      await joining;
    });
    expect(voice.status).toBe("disconnected");
    expect(voice.error).toBe(false);
    expect(voice.channel).toBeNull();
  } finally {
    waitForConnect = undefined;
    await act(async () => root.unmount());
  }
});

test("a rapid switch cancels the old room before issuing a new grant", async () => {
  voiceRequests = [];
  activeRooms = new Set();
  peakRooms = 0;
  const entered = Promise.withResolvers<void>();
  waitForConnect = () => {
    waitForConnect = undefined;
    entered.resolve();
    return new Promise<void>(() => {});
  };
  const controller = createVoiceController(() => {});
  try {
    const first = controller.join("first");
    await entered.promise;
    const another = controller.join("second");
    await Promise.all([first, another]);
    expect(voiceRequests.map((entry) => entry.split(":").slice(0, 3).join(":"))).toEqual([
      "grant:guest:first",
      "leave:guest:first",
      "grant:guest:second",
    ]);
    expect(peakRooms).toBe(1);
    expect(activeRooms.size).toBe(1);
    await controller.leave();
    expect(activeRooms.size).toBe(0);
  } finally {
    controller.dispose();
  }
});

test("a terminal network failure requests one new grant and moderation never auto-joins", async () => {
  voiceRequests = [];
  const reconnected = Promise.withResolvers<void>();
  const controller = createVoiceController((state) => {
    if (
      voiceRequests.filter((entry) => entry.startsWith("grant:")).length === 2 &&
      state.status === "connected"
    )
      reconnected.resolve();
  });
  try {
    await controller.join("voice");
    TestRoom.latest.emit("Disconnected", 9);
    await reconnected.promise;
    expect(voiceRequests.map((entry) => entry.split(":")[0])).toEqual(["grant", "grant"]);
    expect(voiceRequests[1]).toContain(`/resume:${voiceRequests[0]?.slice("grant:".length)}`);
    TestRoom.latest.emit("Disconnected", 4);
    await controller.leave();
    expect(voiceRequests.filter((entry) => entry.startsWith("grant:"))).toHaveLength(2);
    expect(activeRooms.size).toBe(0);
  } finally {
    controller.dispose();
  }
});

test("push-to-talk releases pending capture, applies the selected microphone and respects moderation", async () => {
  publications.length = 0;
  const pending = Promise.withResolvers<ReturnType<typeof mockStream>>();
  const requested = Promise.withResolvers<MediaStreamConstraints>();
  const speaking = Promise.withResolvers<void>();
  const raw = new RawMicrophone();
  capture = (options) => {
    requested.resolve(options);
    return pending.promise;
  };
  const controller = createVoiceController((state) => {
    if (!state.muted) speaking.resolve();
  });
  try {
    await controller.join("voice");
    await controller.setDevice("audioinput", "selection");
    controller.setPushToTalk(true);
    controller.press(true);
    expect((await requested.promise).audio).toMatchObject({ deviceId: { exact: "selection" } });
    controller.press(false);
    pending.resolve(mockStream(raw));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(raw.readyState).toBe("ended");
    expect(publications).toEqual([]);

    const selected = new RawMicrophone();
    capture = async () => mockStream(selected);
    controller.press(true);
    await speaking.promise;
    expect(publications).toEqual([false]);
    expect(selected.enabled).toBe(true);
    controller.toggleDeafen();
    expect(selected.enabled).toBe(false);
    controller.toggleDeafen();
    controller.setForcedMuted(true);
    controller.press(true);
    expect(selected.enabled).toBe(false);
    await controller.leave();
    expect(selected.readyState).toBe("ended");
  } finally {
    capture = async () => mockStream(new RawMicrophone());
    controller.dispose();
  }
});

test("participant volume survives a changed LiveKit session identity", async () => {
  const controller = createVoiceController(() => {});
  const firstVolume = mock((_volume: number) => {});
  const nextVolume = mock((_volume: number) => {});
  const add = (identity: string, setVolume: (volume: number) => void) => {
    const peer = { identity, name: "voice peer", isSpeaking: true, setVolume };
    TestRoom.latest.remoteParticipants.set(identity, peer);
    return peer;
  };
  try {
    await controller.join("one");
    add("peer:first", firstVolume);
    controller.setVolume("peer:first", 0.25);
    expect(firstVolume).toHaveBeenCalledWith(0.25);
    await controller.join("two");
    const peer = add("peer:second", nextVolume);
    const audio = {
      kind: "audio",
      attach: () => document.createElement("audio"),
      detach: () => [],
    };
    TestRoom.latest.emit("TrackSubscribed", audio, null, peer);
    expect(nextVolume).toHaveBeenCalledWith(0.25);
    await controller.leave();
  } finally {
    controller.dispose();
  }
});

test("microphone permission denial leaves the room connected and muted", async () => {
  const denied = Promise.withResolvers<void>();
  capture = async () => {
    throw new DOMException("permission denied", "NotAllowedError");
  };
  const controller = createVoiceController((state) => {
    if (state.error === "microphoneDenied" && state.status === "connected" && state.muted)
      denied.resolve();
  });
  try {
    await controller.join("voice");
    controller.toggleMute();
    await denied.promise;
    await controller.leave();
  } finally {
    capture = async () => mockStream(new RawMicrophone());
    controller.dispose();
  }
});

test("audio output selection uses the active room and supports the system default", async () => {
  voiceRequests = [];
  const media = browser.HTMLMediaElement.prototype;
  const original = Object.getOwnPropertyDescriptor(media, "setSinkId");
  Object.defineProperty(media, "setSinkId", { configurable: true, value: async () => {} });
  let supportsOutput = false;
  const controller = createVoiceController((state) => {
    supportsOutput = state.supportsOutput;
  });
  try {
    expect(supportsOutput).toBe(true);
    await controller.join("voice");
    await controller.setDevice("audiooutput", "headset");
    await controller.setDevice("audiooutput", "default");
    expect(voiceRequests.filter((entry) => entry.startsWith("device:"))).toEqual([
      "device:audiooutput:headset",
      "device:audiooutput:",
    ]);
    await controller.leave();
  } finally {
    if (original) Object.defineProperty(media, "setSinkId", original);
    else Reflect.deleteProperty(media, "setSinkId");
    controller.dispose();
  }
});
