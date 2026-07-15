import { useEffect, useRef } from 'react';

export function useVisibilityReconnect(
  getConnectionState: () => RTCPeerConnectionState | 'unknown',
  onReconnectNeeded: () => void,
) {
  const wasHiddenRef = useRef(false);
  const reconnectCooldownRef = useRef(0);

  const getStateRef = useRef(getConnectionState);
  const onReconnectRef = useRef(onReconnectNeeded);

  getStateRef.current = getConnectionState;
  onReconnectRef.current = onReconnectNeeded;

  useEffect(() => {
    function maybeReconnect() {
      const now = Date.now();
      if (now - reconnectCooldownRef.current < 2500) return;

      const state = getStateRef.current();
      const shouldReconnect =
        state === 'failed' || state === 'closed' || state === 'disconnected';

      if (!shouldReconnect) return;

      reconnectCooldownRef.current = now;
      onReconnectRef.current();
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        wasHiddenRef.current = true;
        return;
      }

      if (document.visibilityState === 'visible' && wasHiddenRef.current) {
        wasHiddenRef.current = false;
        maybeReconnect();
      }
    }

    function onOnline() {
      maybeReconnect();
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', onOnline);
    };
  }, []);
}
