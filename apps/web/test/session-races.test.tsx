import { test, expect, jest, mock, spyOn } from "bun:test";
import type { CurrentUser, MemberPage } from "@yapper/api";
import { Window } from "happy-dom";
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
const browser = new Window({ url: "http://localhost:5173" });
Object.assign(globalThis, {
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  Node: browser.Node,
  Element: browser.Element,
  HTMLElement: browser.HTMLElement,
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
let audioStarts = 0;
let failNextResume = false;
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
  async startAudio() {
    audioStarts++;
  }
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
class TestAPIError extends Error {
  constructor(public status: number) {
    super("test API failure");
  }
}
const calls: string[] = [];
let readChangesOverride:
  | ((channel: string, revision: number) => Promise<{ changes: typeof changes }>)
  | undefined;
let changes: { id: string; revision: number; message: typeof sample | null }[] = [];
const { restoreAccount, login } = await import("../src/api");
const readMembers = mock(async (): Promise<MemberPage> => ({ members: [], next: "" }));
const readAudit = mock(async () => ({ events: [] }));
const readTimeline = mock(async (channel: string) => ({
  messages: [{ ...sample, channelId: channel }],
  before: 0,
  revision: 1,
}));
mock.module("../src/api", () => ({
  api: {
    ticket: async () => ({ ticket: "ticket" }),
    members: readMembers,
    audit: readAudit,
    timeline: readTimeline,
    messageChanges: async (channel: string, revision: number) => {
      calls.push(channel);
      if (readChangesOverride) return readChangesOverride(channel, revision);
      return { changes: changes.filter((change) => change.revision > revision) };
    },
  },
  APIError: TestAPIError,
  request: async (
    path: string,
    input: { channelId?: string; identity?: string; resumeIdentity?: string },
  ) => {
    if (path.endsWith("grant")) {
      const identity = `guest:${input.channelId}:${++grantNumber}`;
      voiceRequests.push(
        `grant:${identity}${input.resumeIdentity ? `/resume:${input.resumeIdentity}` : ""}`,
      );
      if (input.resumeIdentity && failNextResume) {
        failNextResume = false;
        throw new TestAPIError(503);
      }
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

const { ModerationPanel } = await import("../src/moderation-panel");
const { MessageHistory } = await import("../src/message-history");

for (const { path, run } of [
  { path: "/api/auth/get-session", run: restoreAccount },
  { path: "/api/auth/token", run: () => login("moderator", "password") },
]) {
  test(`the account deadline covers the JSON body at ${path}`, async () => {
    const immediate = setImmediate;
    const nextTurn = () => new Promise<void>((resolve) => immediate(resolve));
    jest.useFakeTimers();
    const headersReceived = Promise.withResolvers<void>();
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (url !== path) return new Response("{}");
      const signal = init?.signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{"));
            signal?.addEventListener("abort", () => controller.error(signal.reason), {
              once: true,
            });
            headersReceived.resolve();
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });
    try {
      let outcome = "pending";
      void run().then(
        () => {
          outcome = "completed";
        },
        (error: DOMException) => {
          outcome = error.name;
        },
      );
      await headersReceived.promise;
      await nextTurn();
      jest.advanceTimersByTime(7999);
      await nextTurn();
      expect(outcome).toBe("pending");
      jest.advanceTimersByTime(1);
      await nextTurn();
      expect(outcome).toBe("AbortError");
    } finally {
      fetchMock.mockRestore();
      jest.useRealTimers();
    }
  });
}

test("moderation retries a failed participant directory independently of the audit", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const member = {
    id: "guest",
    nickname: "Guest",
    role: "participant",
    micMuted: false,
    banned: false,
    registered: false,
    canBlockIp: false,
    ipBlocked: false,
  } as const;
  readMembers.mockClear();
  readAudit.mockClear();
  readMembers.mockRejectedValueOnce(new Error("directory unavailable"));
  readMembers.mockResolvedValueOnce({ members: [member], next: "" });
  readAudit.mockRejectedValueOnce(new Error("audit unavailable"));
  const button = (label: string) => {
    const found = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent === label,
    );
    if (!found) throw new Error(`missing button: ${label}`);
    return found;
  };
  try {
    await act(async () =>
      root.render(
        <ModerationPanel
          actor={{ id: "staff", nickname: "Staff", role: "moderator", micMuted: false }}
          locale="en"
          target={{ id: "", request: 0 }}
          revision={0}
          onClose={() => {}}
        />,
      ),
    );
    const selector = container.querySelector("select");
    expect(selector?.disabled).toBe(true);
    await act(async () => button("Reload").click());
    expect(readMembers).toHaveBeenCalledTimes(1);
    expect(readAudit).toHaveBeenCalledTimes(2);
    expect(selector?.disabled).toBe(true);
    await act(async () => button("Reload participants").click());
    expect(selector?.disabled).toBe(false);
    expect(selector?.options[1]?.value).toBe("guest");
    expect(readMembers).toHaveBeenCalledTimes(2);
    expect(readAudit).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Could not load participants.");
  } finally {
    await act(async () => root.unmount());
  }
});

test("chat shows the empty state only after the new channel's history resolves empty", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const emptyText = "Tutaj zaczyna się rozmowa.";
  const user: CurrentUser = {
    participant: { id: "viewer", nickname: "Viewer", role: "participant", micMuted: false },
    channels: [],
    categories: [],
    account: false,
  };
  function Harness({ channel }: { channel: string }) {
    const conversation = useConversation(channel, refreshCommunity);
    return (
      <MessageHistory
        key={channel}
        items={conversation.messages}
        historyReady={conversation.historyReady}
        loadingHistory={conversation.loadingHistory}
        hasOlder={conversation.hasOlder}
        loadingOlder={conversation.loadingOlder}
        onLoadOlder={conversation.loadOlder}
        onChanged={conversation.refresh}
        onModerate={() => {}}
        archived={false}
        locked={false}
        user={user}
        locale="pl"
      />
    );
  }
  type Page = Awaited<ReturnType<typeof readTimeline>>;
  const secondPage = Promise.withResolvers<Page>();
  const emptyPage = Promise.withResolvers<Page>();
  const busy = () => container.querySelector("section")?.getAttribute("aria-busy");
  try {
    await act(async () => root.render(<Harness channel="a" />));
    await act(async () => TestSocket.last.emit("ready"));
    expect(container.textContent).toContain("before");

    readTimeline.mockImplementationOnce(() => secondPage.promise);
    await act(async () => root.render(<Harness channel="b" />));
    await act(async () => TestSocket.last.emit("ready"));
    expect(busy()).toBe("true");
    expect(container.textContent).not.toContain("before");
    expect(container.textContent).not.toContain(emptyText);
    await act(async () =>
      secondPage.resolve({
        messages: [{ ...sample, channelId: "b", body: "Second channel" }],
        before: 0,
        revision: 1,
      }),
    );
    expect(container.textContent).toContain("Second channel");
    expect(busy()).toBe("false");

    readTimeline.mockImplementationOnce(() => emptyPage.promise);
    await act(async () => root.render(<Harness channel="c" />));
    await act(async () => TestSocket.last.emit("ready"));
    expect(container.textContent).not.toContain(emptyText);
    await act(async () => emptyPage.resolve({ messages: [], before: 0, revision: 0 }));
    expect(container.textContent).toContain(emptyText);
    expect(busy()).toBe("false");
  } finally {
    await act(async () => root.unmount());
  }
});

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

test("chat publishes a deletion before the next change batch and clears its recovered error", async () => {
  const root = createRoot(document.createElement("div"));
  let conversation!: ReturnType<typeof useConversation>;
  function Harness() {
    const value = useConversation("a", refreshCommunity);
    useLayoutEffect(() => {
      conversation = value;
    });
    return null;
  }
  const secondBatch = Promise.withResolvers<{ changes: typeof changes }>();
  const requestedSecondBatch = Promise.withResolvers<void>();
  const fault = new TestAPIError(503);
  changes = [];
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => TestSocket.last.emit("ready"));
    expect(conversation.messages).toHaveLength(1);
    const batch = Array.from({ length: 100 }, (_, index) => ({
      id: index === 0 ? sample.id : String(index),
      revision: index + 2,
      message: null,
    }));
    readChangesOverride = async (_channel, after) => {
      if (after === 1) return { changes: batch };
      requestedSecondBatch.resolve();
      return secondBatch.promise;
    };
    await act(async () => {
      TestSocket.last.emit("messages.changed", { channelId: "a" });
      await requestedSecondBatch.promise;
    });
    expect(conversation.messages).toHaveLength(0);
    await act(async () => secondBatch.reject(fault));
    expect(conversation.error).toBe(fault);
    readChangesOverride = undefined;
    await act(async () => conversation.refresh("a"));
    expect(conversation.error).toBeNull();
    expect(conversation.messages).toHaveLength(0);
  } finally {
    readChangesOverride = undefined;
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

test("a transient grant failure retries the same predecessor without releasing it", async () => {
  voiceRequests = [];
  const reconnected = Promise.withResolvers<void>();
  const controller = createVoiceController((state) => {
    if (voiceRequests.length === 3 && state.status === "connected") reconnected.resolve();
  });
  try {
    await controller.join("voice");
    const predecessor = voiceRequests[0]?.slice("grant:".length);
    failNextResume = true;
    TestRoom.latest.emit("Disconnected", 9);
    await reconnected.promise;
    expect(voiceRequests.map((entry) => entry.split("/resume:")[1])).toEqual([
      undefined,
      predecessor,
      predecessor,
    ]);
    expect(voiceRequests.every((entry) => entry.startsWith("grant:"))).toBe(true);
    await controller.leave();
  } finally {
    failNextResume = false;
    controller.dispose();
  }
});

test("deafen blocks playback starts, including while a room is joining", async () => {
  audioStarts = 0;
  const controller = createVoiceController(() => {});
  try {
    controller.toggleDeafen();
    await controller.join("voice");
    await controller.startAudio();
    expect(audioStarts).toBe(0);
    controller.toggleDeafen();
    expect(audioStarts).toBe(1);
    await controller.leave();
  } finally {
    controller.dispose();
  }
});

test("SDK playback without a status event cannot restore deafened remote audio", async () => {
  const controller = createVoiceController(() => {});
  const attached = new Set<HTMLMediaElement>();
  const peer = { identity: "peer", setVolume: mock((_volume: number) => {}) };
  function track() {
    return {
      kind: "audio",
      attach: mock((element: HTMLMediaElement) => {
        attached.add(element);
        return element;
      }),
      detach: mock((element: HTMLMediaElement) => attached.delete(element)),
    };
  }
  const before = track();
  const during = track();
  const unsubscribed = track();
  try {
    await controller.join("voice");
    const room = TestRoom.latest;
    room.emit("TrackSubscribed", before, null, peer);
    expect(attached.size).toBe(1);
    const [previous] = attached;

    controller.toggleDeafen();
    room.emit("TrackSubscribed", during, null, peer);
    room.emit("TrackSubscribed", unsubscribed, null, peer);
    room.emit("TrackUnsubscribed", unsubscribed);
    // LiveKit only touches attached elements and emits no event if playback is already enabled.
    for (const element of attached) element.muted = false;
    expect(attached.size).toBe(0);
    expect(previous?.muted).toBe(true);
    expect(previous?.isConnected).toBe(false);
    expect(during.attach).not.toHaveBeenCalled();

    controller.toggleDeafen();
    expect(attached.size).toBe(2);
    expect(unsubscribed.attach).not.toHaveBeenCalled();
    await controller.leave();
    expect(attached.size).toBe(0);
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
