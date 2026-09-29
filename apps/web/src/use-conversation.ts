import { useEffect, useState } from "react";
import type { Message } from "@yapper/api";
import { api, APIError } from "./api";
export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";
function combine(previous: Message[], incoming: Message[]) {
  const map = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) map.set(message.id, message);
  return [...map.values()].sort((a, b) => a.sequence - b.sequence);
}
export function useConversation(channel: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<unknown>(null);
  const [previousChannel, setPreviousChannel] = useState(channel);
  if (previousChannel !== channel) {
    setPreviousChannel(channel);
    setMessages([]);
    setStatus("connecting");
    setError(null);
  }
  useEffect(() => subscribeConversation(channel, setMessages, setStatus, setError), [channel]);
  return {
    messages,
    status,
    error,
    append: (message: Message) => setMessages((previous) => combine(previous, [message])),
  };
}

// Own the asynchronous transport lifecycle independently of React rendering.
// Every completion checks the abort signal before publishing state.
function subscribeConversation(
  channel: string,
  setMessages: (update: (previous: Message[]) => Message[]) => void,
  setStatus: (status: ConnectionState) => void,
  setError: (error: unknown) => void,
) {
  const controller = new AbortController();
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cursor = 0;
  let reconciling = false;
  async function reconcile() {
    if (reconciling) return;
    reconciling = true;
    try {
      while (!controller.signal.aborted) {
        const page = await api.history(channel, cursor, controller.signal);
        if (controller.signal.aborted) return;
        setMessages((previous) => combine(previous, page.messages));
        const last = page.messages.at(-1);
        if (last) cursor = last.sequence;
        if (page.messages.length < 100) break;
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e);
    } finally {
      reconciling = false;
    }
  }
  async function connect() {
    try {
      const { ticket } = await api.ticket();
      if (controller.signal.aborted) return;
      const address = new URL("/api/v1/events", location.href);
      address.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(address, ["yapper.v1", `yapper.ticket.${ticket}`]);
      socket.onmessage = (event) => {
        if (controller.signal.aborted) return;
        let message: { type: string; payload: Message };
        try {
          message = JSON.parse(String(event.data)) as typeof message;
        } catch {
          return;
        }
        if (message.type === "ready") {
          setStatus("connected");
          setError(null);
          void reconcile();
        }
        if (message.type === "message.created" && message.payload.channelId === channel)
          setMessages((previous) => combine(previous, [message.payload]));
      };
      socket.onclose = () => {
        if (!controller.signal.aborted) {
          setStatus("reconnecting");
          timer = setTimeout(() => void connect(), 1500);
        }
      };
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e);
      if (e instanceof APIError && e.status === 403) {
        setStatus("disconnected");
        return;
      }
      setStatus("reconnecting");
      timer = setTimeout(() => void connect(), 2500);
    }
  }
  if (channel) void connect();
  return () => {
    controller.abort();
    clearTimeout(timer);
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
  };
}
