import { useEffect, useRef } from 'react';
import { Client, errorMessage } from '../lib/api';
export function ReadMarker({
  client,
  channel,
  last,
  onError,
}: {
  client: Client;
  channel: string;
  last: string;
  onError: (message: string) => void;
}) {
  const marker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let visible = false;
    let sent = false;
    const mark = () => {
      if (!visible || sent || document.visibilityState !== 'visible') return;
      sent = true;
      void client
        .request(`/channels/${channel}/read-state`, {
          method: 'PUT',
          body: JSON.stringify({ last_message_id: last }),
          signal: controller.signal,
        })
        .catch((e) => {
          sent = false;
          if (!controller.signal.aborted) onError(errorMessage(e));
        });
    };
    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      mark();
    });
    if (marker.current) observer.observe(marker.current);
    document.addEventListener('visibilitychange', mark);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', mark);
      controller.abort();
    };
  }, [client, channel, last, onError]);
  return <div ref={marker} className="read-marker" aria-hidden="true" />;
}
