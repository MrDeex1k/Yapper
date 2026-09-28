import { useEffect, useRef, useState } from 'react';
import type { Room } from 'livekit-client';
import { errorMessage } from '../lib/api';
import { Button } from './ui/button';
export function PushToTalk({ room, onError }: { room: Room; onError: (message: string) => void }) {
  const [enabled, setEnabled] = useState(false);
  const queue = useRef<Promise<void> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const transmit = (value: boolean) => {
      queue.current = (queue.current ?? Promise.resolve())
        .then(async () => {
          if (room.state === 'connected') await room.localParticipant.setMicrophoneEnabled(value);
        })
        .catch((e) => onError(errorMessage(e)));
    };
    const down = (event: KeyboardEvent) => {
      if (
        event.code !== 'KeyV' ||
        event.repeat ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      event.preventDefault();
      transmit(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'KeyV') transmit(false);
    };
    const release = () => transmit(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
      transmit(false);
    };
  }, [enabled, room, onError]);
  async function toggle() {
    try {
      await room.localParticipant.setMicrophoneEnabled(false);
      setEnabled((value) => !value);
    } catch (e) {
      onError(errorMessage(e));
    }
  }
  return (
    <div className="ptt">
      <Button variant="outline" aria-pressed={enabled} onClick={toggle}>
        {enabled ? 'Push-to-talk on · Hold V' : 'Enable push-to-talk'}
      </Button>
      <small>Works while this app is focused. Typing does not activate your microphone.</small>
    </div>
  );
}
