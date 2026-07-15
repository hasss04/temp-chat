import { useEffect, useRef } from 'react';

export function useVisibilityReconnect(
  getConnectionState: () => RTCPeerConnectionState | 'unknown',
  onReconnectNeeded: () => void
) {
  const wasHiddenRef = useRef(false);
  const getStateRef = useRef(getConnectionState);
  const onReconnectRef = useRef(onReconnectNeeded);

  // keep refs current without re-triggering the effect below
  getStateRef.current = getConnectionState;
  onReconnectRef.current = onReconnectNeeded;

  useEffect(() => {
    function checkAndMaybeReconnect() {
      const state = getStateRef.current();
      const dead = state === 'failed' || state === 'disconnected' || state === 'closed';
      if (dead) onReconnectRef.current();
    }

    function onVisibility() {
      if (document.visibilityState === 'visible' && wasHiddenRef.current) {
        wasHiddenRef.current = false;
        checkAndMaybeReconnect();
      }
      if (document.visibilityState === 'hidden') {
        wasHiddenRef.current = true;
      }
    }

    function onOnline() {
      checkAndMaybeReconnect();
    }

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, []); // stable — runs exactly once per mount, never re-triggers
}