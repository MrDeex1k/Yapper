import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import { errorMessage } from '../lib/api';
export function DesktopPTT({
  room,
  onError,
  blocked,
}: {
  room: Room;
  onError: (message: string) => void;
  blocked: boolean;
}) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('Global hold-to-talk is off.');
  const queue = useRef<Promise<unknown> | null>(null);
  const canTalk = useEffectEvent((pressed: boolean) => pressed && !blocked);
  useEffect(() => {
    const bridge = window.yapperDesktop;
    if (!bridge || !enabled) return;
    let active = true;
    const unsubscribe = bridge.onPTT((pressed) => {
      queue.current = (queue.current ?? Promise.resolve())
        .then(() => room.localParticipant.setMicrophoneEnabled(active && canTalk(pressed)))
        .catch((e) => onError(errorMessage(e)));
    });
    return () => {
      active = false;
      unsubscribe();
      void bridge.configurePTT(null);
      queue.current = (queue.current ?? Promise.resolve())
        .then(() => room.localParticipant.setMicrophoneEnabled(false))
        .catch((e) => onError(errorMessage(e)));
    };
  }, [room, enabled, onError]);
  async function configure(key: string) {
    try {
      await room.localParticipant.setMicrophoneEnabled(false);
      const result = await window.yapperDesktop?.configurePTT(
        key === '' ? null : (key as 'F8' | 'F9' | 'F10'),
      );
      setEnabled(result?.enabled ?? false);
      setStatus(result?.reason ?? 'Desktop only');
    } catch (e) {
      onError(errorMessage(e));
    }
  }
  return (
    <div>
      <label>
        Global push-to-talk
        <select defaultValue="" onChange={(e) => void configure(e.target.value)}>
          <option value="">Off</option>
          <option>F8</option>
          <option>F9</option>
          <option>F10</option>
        </select>
      </label>
      <output>{status}</output>
    </div>
  );
}
