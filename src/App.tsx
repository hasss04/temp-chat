import { useEffect, useRef } from 'react';
import { SignalBridge } from './components/SignalBridge';
import { SetupPanel } from './components/SetupPanel';
import { ToastHost } from './components/ToastHost';
import { restoreMessages, restoreSession } from './lib/storage';
import { useAppStore, watchOnlineStatus, watchSystemTheme } from './store/useAppStore';

export default function App() {
  const roomId = useAppStore((s) => s.roomId);
  const setStatePartial = useAppStore((s) => s.setStatePartial);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const pushToast = useAppStore((s) => s.pushToast);

  const hydratedRef = useRef(false);

  useEffect(() => {
    const stopThemeWatch = watchSystemTheme();
    const stopOnlineWatch = watchOnlineStatus();

    return () => {
      stopThemeWatch();
      stopOnlineWatch();
    };
  }, []);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    let disposed = false;

    void (async () => {
      try {
        const session = await restoreSession().catch(() => undefined);
        if (disposed || !session) return;

        if (session.theme) {
          setThemeMode(session.theme);
        }

        if (!session.roomId || !session.secret) return;

        const messages = await restoreMessages(session.roomId, session.secret).catch(() => []);

        if (disposed) return;

        setStatePartial({
          roomId: session.roomId,
          nickname: session.nickname?.trim() || 'Anon',
          secret: session.secret,
          activeTab: session.activeTab ?? 'chat',
          draft: session.draft ?? '',
          messages,
          connectionStatus: 'joining',
          roomFull: false,
        });
      } catch (error) {
        console.error('Failed to restore app session', error);
        if (!disposed) {
          pushToast({
            tone: 'error',
            title: 'Session restore failed',
            message: 'Local room state could not be restored on this device.',
          });
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [pushToast, setStatePartial, setThemeMode]);

  return (
    <div className="app-shell">
      {roomId ? <SignalBridge /> : <SetupPanel />}
      <ToastHost />
    </div>
  );
}