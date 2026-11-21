import { useEffect, useRef, useState } from "react";
import { createVoiceController, initialVoiceState, type AudioDeviceKind } from "./voice-controller";

export function useVoice(forcedMuted = false, kicked = false) {
  const controller = useRef<ReturnType<typeof createVoiceController> | null>(null);
  const [state, setState] = useState(initialVoiceState);
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
    if (!state.pushToTalk || state.status !== "connected") return;
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
          target.closest(
            "input,textarea,select,button,a,[contenteditable]:not([contenteditable=false])",
          )
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
  }, [state.pushToTalk, state.status]);

  return {
    ...state,
    join: async (channel: string) => {
      if (!kicked) await controller.current?.join(channel);
    },
    leave: async () => controller.current?.leave(),
    toggleMute: () => controller.current?.toggleMute(),
    toggleDeafen: () => controller.current?.toggleDeafen(),
    setPushToTalk: (enabled: boolean) => controller.current?.setPushToTalk(enabled),
    press: (enabled: boolean) => controller.current?.press(enabled),
    setVolume: (identity: string, volume: number) =>
      controller.current?.setVolume(identity, volume),
    setDevice: (kind: AudioDeviceKind, id: string) => controller.current?.setDevice(kind, id),
    refreshDevices: () => controller.current?.refreshDevices(),
    pickOutput: () => controller.current?.pickOutput(),
    startAudio: () => controller.current?.startAudio(),
  };
}
