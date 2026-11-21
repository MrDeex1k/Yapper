import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Message } from "@yapper/api";
import { api, APIError } from "./api";

export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "kicked";
type HistoryState = { messages: Message[]; hasOlder: boolean; loadingOlder: boolean };
const emptyHistory: HistoryState = { messages: [], hasOlder: false, loadingOlder: false };

export function useConversation(
  channel: string,
  refreshCommunity: (signal: AbortSignal) => Promise<void>,
) {
  const activeChannel = useRef(channel);
  const subscription = useRef<ReturnType<typeof subscribeConversation> | null>(null);
  useLayoutEffect(() => {
    activeChannel.current = channel;
  }, [channel]);
  const [history, setHistory] = useState(emptyHistory);
  const [status, setStatus] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<unknown>(null);
  const [timelineError, setTimelineError] = useState<unknown>(null);
  const [memberRevision, setMemberRevision] = useState(0);
  const paused = status === "kicked";
  const [previousChannel, setPreviousChannel] = useState(channel);
  if (previousChannel !== channel) {
    setPreviousChannel(channel);
    setHistory(emptyHistory);
    if (!paused) setStatus("connecting");
    setError(null);
    setTimelineError(null);
  }
  useEffect(() => {
    if (paused) return;
    const next = subscribeConversation(channel, refreshCommunity, {
      setHistory: (page) => {
        if (activeChannel.current === channel) setHistory(page);
      },
      setStatus,
      setError,
      setTimelineError,
      membersChanged: () => setMemberRevision((revision) => revision + 1),
    });
    subscription.current = next;
    return () => {
      subscription.current = null;
      next.close();
    };
  }, [channel, paused, refreshCommunity]);

  return {
    ...history,
    status,
    error: error ?? timelineError,
    memberRevision,
    reconnect: () => setStatus("connecting"),
    refresh: (changedChannel: string) => {
      if (
        activeChannel.current === changedChannel &&
        subscription.current?.channel === changedChannel
      )
        subscription.current.sync();
    },
    loadOlder: () => subscription.current?.loadOlder(),
  };
}

type ConversationObserver = {
  setHistory: (page: HistoryState) => void;
  setStatus: (status: ConnectionState) => void;
  setError: (error: unknown) => void;
  setTimelineError: (error: unknown) => void;
  membersChanged: () => void;
};

function subscribeConversation(
  channel: string,
  refreshCommunity: (signal: AbortSignal) => Promise<void>,
  observer: ConversationObserver,
) {
  const controller = new AbortController();
  const { signal } = controller;
  const timeline = subscribeTimeline(channel, signal, observer);
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function connect() {
    try {
      const { ticket } = await api.ticket();
      if (signal.aborted) return;
      const address = new URL("/api/v1/events", location.href);
      address.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(address, ["yapper.v1", `yapper.ticket.${ticket}`]);
      socket.onmessage = (event) => {
        if (signal.aborted) return;
        let envelope: { type: string; payload?: { channelId?: string } };
        try {
          envelope = JSON.parse(String(event.data)) as typeof envelope;
        } catch {
          return;
        }
        if (envelope.type === "ready") {
          observer.setStatus("connected");
          observer.setError(null);
          timeline.sync();
        }
        if (envelope.type === "ready" || envelope.type === "members.changed")
          observer.membersChanged();
        if (["ready", "catalog.changed", "members.changed"].includes(envelope.type)) {
          void refreshCommunity(signal).catch((e) => {
            if (!signal.aborted) observer.setError(e);
          });
        }
        if (
          (envelope.type === "message.created" || envelope.type === "messages.changed") &&
          envelope.payload?.channelId === channel
        )
          timeline.sync();
      };
      socket.onclose = (event) => {
        if (signal.aborted) return;
        if (event.code === 4001) {
          observer.setStatus("kicked");
          return;
        }
        observer.setStatus("reconnecting");
        timer = setTimeout(() => void connect(), 1500);
      };
    } catch (e) {
      if (signal.aborted) return;
      observer.setError(e);
      if (e instanceof APIError && e.status === 403) {
        observer.setStatus("disconnected");
        return;
      }
      observer.setStatus("reconnecting");
      timer = setTimeout(() => void connect(), 2500);
    }
  }
  void connect();
  return {
    channel,
    ...timeline,
    close() {
      controller.abort();
      clearTimeout(timer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    },
  };
}

// Page reads and change reads share a queue. A late page response cannot restore
// a message whose deletion was already applied by the same subscription.
function subscribeTimeline(channel: string, signal: AbortSignal, observer: ConversationObserver) {
  const messages = new Map<string, Message>();
  let revision: number | null = null;
  let before = 0;
  let loadingOlder = false;
  let dirty = false;
  let queued = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let operations = Promise.resolve();
  signal.addEventListener("abort", () => clearTimeout(retry), { once: true });

  function publish() {
    if (signal.aborted) return;
    observer.setHistory({
      messages: [...messages.values()].sort((a, b) => a.sequence - b.sequence),
      hasOlder: before !== 0,
      loadingOlder,
    });
  }
  function enqueue(action: () => Promise<void>) {
    operations = operations
      .then(async () => {
        if (!signal.aborted) await action();
      })
      .catch((e) => {
        if (!signal.aborted) observer.setTimelineError(e);
      });
  }
  async function readPage(cursor: number) {
    const page = await api.timeline(channel, cursor, signal);
    for (const message of page.messages) messages.set(message.id, message);
    before = page.before;
    if (cursor === 0) revision = page.revision;
  }
  async function readChanges(after: number) {
    let cursor = after;
    while (!signal.aborted) {
      const { changes } = await api.messageChanges(channel, cursor, signal);
      for (const change of changes) {
        if (!change.message) messages.delete(change.id);
        else if (change.message.sequence >= before) messages.set(change.id, change.message);
        cursor = change.revision;
      }
      revision = cursor;
      publish();
      if (changes.length < 100) return;
    }
  }
  function sync() {
    if (!channel || signal.aborted) return;
    dirty = true;
    clearTimeout(retry);
    if (queued) return;
    queued = true;
    enqueue(async () => {
      try {
        while (dirty && !signal.aborted) {
          dirty = false;
          if (revision === null) {
            await readPage(0);
            publish();
          }
          if (revision !== null) await readChanges(revision);
          observer.setTimelineError(null);
        }
      } catch (e) {
        if (!signal.aborted && !(e instanceof APIError && e.status === 403))
          retry = setTimeout(sync, 2000);
        throw e;
      } finally {
        queued = false;
      }
    });
  }
  return {
    sync,
    loadOlder() {
      if (signal.aborted || loadingOlder || before === 0) return;
      loadingOlder = true;
      publish();
      enqueue(async () => {
        try {
          await readPage(before);
        } finally {
          loadingOlder = false;
          publish();
        }
      });
    },
  };
}
