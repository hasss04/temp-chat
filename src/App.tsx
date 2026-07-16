import { useEffect, useState } from 'react';
import { SignalBridge } from './components/SignalBridge';
import { SetupPanel } from './components/SetupPanel';
import { ToastHost } from './components/ToastHost';
import { restoreMessages, restoreActiveSession } from './lib/storage';
import { useAppStore, watchOnlineStatus, watchSystemTheme } from './store/useAppStore';

export default function App() {
  const roomId = useAppStore((s) => s.roomId);
  const setStatePartial = useAppStore((s) => s.setStatePartial);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const pushToast = useAppStore((s) => s.pushToast);

  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    const stopThemeWatch = watchSystemTheme();
    const stopOnlineWatch = watchOnlineStatus();

    return () => {
      stopThemeWatch();
      stopOnlineWatch();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    setHydrating(true);

    void (async () => {
      try {
        const session = await restoreActiveSession().catch(() => undefined);

        if (cancelled) return;

        if (!session) {
          setHydrating(false);
          return;
        }

        if (session.theme) {
          setThemeMode(session.theme);
        }

        if (!session.roomId || !session.secret) {
          setHydrating(false);
          return;
        }

        const messages = await restoreMessages(session.roomId, session.secret).catch(() => []);

        if (cancelled) return;

        setStatePartial({
          roomId: session.roomId,
          peerId: session.peerId,
          nickname: session.nickname?.trim() || 'Anon',
          secret: session.secret,
          activeTab: session.activeTab ?? 'chat',
          draft: session.draft ?? '',
          messages,
          connectionStatus: 'joining',
          roomFull: false,
        });
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to restore app session', error);
          pushToast({
            tone: 'error',
            title: 'Session restore failed',
            message: 'Local room state could not be restored on this device.',
          });
        }
      } finally {
        if (!cancelled) {
          setHydrating(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pushToast, setStatePartial, setThemeMode]);

  if (hydrating) {
    return (
      <div className="app-shell">
        <div style={{ padding: 20 }}>Loading…</div>
        <ToastHost />
      </div>
    );
  }

  return (
    <div className="app-shell">
      {roomId ? <SignalBridge /> : <SetupPanel />}
      <ToastHost />
    </div>
  );
}