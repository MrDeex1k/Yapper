import { test, expect, mock } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
const browser = new Window({ url: "http://localhost:5173" });
Object.assign(globalThis, {
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  location: browser.location,
  IS_REACT_ACT_ENVIRONMENT: true,
});
let rejectConnect: (error: Error) => void = () => {};
let enteredConnect: () => void = () => {};
class TestRoom {
  localParticipant = { identity: "guest", name: "guest", isSpeaking: false };
  remoteParticipants = new Map();
  canPlaybackAudio = true;
  on() {
    return this;
  }
  connect() {
    return new Promise<void>((_resolve, reject) => {
      rejectConnect = reject;
      enteredConnect();
    });
  }
  async disconnect() {
    rejectConnect(new Error("connection canceled"));
  }
  async startAudio() {}
}
mock.module("livekit-client", () => ({
  Room: TestRoom,
  RoomEvent: {},
  Track: { Kind: { Audio: "audio" } },
  ConnectionState: {},
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
  request: async (path: string) =>
    path.endsWith("grant")
      ? { identity: "guest:epoch", channelId: "voice", token: "test", url: "ws://localhost" }
      : { left: true },
}));
const refreshCommunity = async () => {};
const { useConversation } = await import("../src/use-conversation");
const { useVoice } = await import("../src/use-voice");

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
    const connecting = new Promise<void>((resolve) => {
      enteredConnect = resolve;
    });
    let joining!: Promise<void>;
    await act(async () => {
      joining = voice.join("voice");
      await connecting;
    });
    await act(async () => {
      await voice.leave();
      await joining;
    });
    expect(voice.status).toBe("disconnected");
    expect(voice.error).toBe(false);
    expect(voice.channel).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
