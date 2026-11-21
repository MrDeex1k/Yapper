import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createVoiceController, initialVoiceState, type AudioDeviceKind } from "./voice-controller";

const desktopPointer = "(pointer: fine) and (hover: hover)";
const editableTarget = "input,textarea,select,[contenteditable]:not([contenteditable=false])";

function subscribeToPointer(change: () => void) {
  const query = window.matchMedia(desktopPointer);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
}

function hasDesktopPointer() {
  return Boolean(window.yapperDesktop) || window.matchMedia(desktopPointer).matches;
}

function useKeyboardAvailability() {
  const desktop = useSyncExternalStore(subscribeToPointer, hasDesktopPointer);
  const [usedKeyboard, setUsedKeyboard] = useState(false);
  useEffect(() => {
    if (usedKeyboard) return;
    function detectKeyboard(event: KeyboardEvent) {
      if (
        event.isTrusted &&
        event.key === "Tab" &&
        !event.isComposing &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !(event.target instanceof Element && event.target.closest(editableTarget))
      ) {
        setUsedKeyboard(true);
      }
    }
    window.addEventListener("keydown", detectKeyboard, true);
    return () => window.removeEventListener("keydown", detectKeyboard, true);
  }, [usedKeyboard]);
  return desktop || usedKeyboard;
}

export function useVoice(forcedMuted = false, kicked = false) {
  const controller = useRef<ReturnType<typeof createVoiceController> | null>(null);
  const [state, setState] = useState(initialVoiceState);
  const canUsePushToTalk = useKeyboardAvailability();
  const pushToTalk = canUsePushToTalk && state.pushToTalk;
  useEffect(() => {
    const voice = createVoiceController(setState);
    controller.current = voice;
    return () => {
      controller.current = null;
      voice.dispose();
    };
  }, []);
  useEffect(() => {
    controller.current?.setForcedMuted(forcedMuted);
  }, [forcedMuted]);
  useEffect(() => {
    if (kicked) void controller.current?.leave();
  }, [kicked]);
  useEffect(() => {
    if (!canUsePushToTalk && state.pushToTalk) controller.current?.setPushToTalk(false);
  }, [canUsePushToTalk, state.pushToTalk]);
  useEffect(() => {
    if (!pushToTalk || state.status !== "connected") return;
    const events = new AbortController();
    const { signal } = events;
    const release = () => controller.current?.press(false);
    window.addEventListener("blur", release, { signal });
    window.addEventListener("pagehide", release, { signal });
    document.addEventListener("visibilitychange", release, { signal });
    window.addEventListener(
      "keydown",
      (event) => {
        if (
          event.code !== "Space" ||
          event.repeat ||
          event.isComposing ||
          event.defaultPrevented ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          document.hidden
        )
          return;
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest(`${editableTarget},button,a,summary,[role=button],[role=slider]`)
        )
          return;
        event.preventDefault();
        controller.current?.press(true);
      },
      { signal },
    );
    window.addEventListener(
      "keyup",
      (event) => {
        if (event.code === "Space") release();
      },
      { signal },
    );
    return () => {
      events.abort();
      release();
    };
  }, [pushToTalk, state.status]);

  return {
    ...state,
    canUsePushToTalk,
    pushToTalk,
    join: async (channel: string) => {
      if (!kicked) await controller.current?.join(channel);
    },
    leave: async () => controller.current?.leave(),
    toggleMute: () => controller.current?.toggleMute(),
    toggleDeafen: () => controller.current?.toggleDeafen(),
    setPushToTalk: (enabled: boolean) => {
      if (!enabled || canUsePushToTalk) controller.current?.setPushToTalk(enabled);
    },
    setVolume: (identity: string, volume: number) =>
      controller.current?.setVolume(identity, volume),
    setDevice: (kind: AudioDeviceKind, id: string) => controller.current?.setDevice(kind, id),
    refreshDevices: () => controller.current?.refreshDevices(),
    pickOutput: () => controller.current?.pickOutput(),
    startAudio: () => controller.current?.startAudio(),
  };
}
