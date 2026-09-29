import { test, expect, mock } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
const browser = new Window({ url: "http://localhost:5173" });
Object.assign(globalThis, {
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
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
mock.module("../src/api", () => ({
  api: { ticket: () => new Promise(() => {}), history: async () => ({ messages: [] }) },
  APIError: class extends Error {},
  request: async (path: string) =>
    path.endsWith("grant")
      ? { identity: "guest:epoch", channelId: "voice", token: "test", url: "ws://localhost" }
      : { left: true },
}));
const { useConversation } = await import("../src/use-conversation");
const { useVoice } = await import("../src/use-voice");

test("late send result cannot append to a newly selected channel", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  let conversation!: ReturnType<typeof useConversation>;
  function Harness({ channel }: { channel: string }) {
    const value = useConversation(channel);
    useLayoutEffect(() => {
      conversation = value;
    });
    return null;
  }
  try {
    await act(async () => root.render(createElement(Harness, { channel: "a" })));
    const staleAppend = conversation.append;
    await act(async () => root.render(createElement(Harness, { channel: "b" })));
    const message = {
      id: "id",
      channelId: "a",
      authorId: "guest",
      nickname: "guest",
      sequence: 1,
      body: "old channel",
      createdAt: new Date().toISOString(),
    };
    await act(async () => staleAppend(message));
    expect(conversation.messages).toHaveLength(0);
    await act(async () => conversation.append({ ...message, channelId: "b" }));
    expect(conversation.messages).toHaveLength(1);
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
