import { SignalHigh, SignalMedium, RefreshCw } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

export function ConnectionBanner() {
  const isOnline = useAppStore((s) => s.isOnline);
  const connectionStatus = useAppStore((s) => s.connectionStatus);

  if (!isOnline) {
    return (
      <div className="conn-banner offline" role="status">
        <SignalMedium size={15} />
        <span>You&apos;re offline. Messages will send once you reconnect.</span>
      </div>
    );
  }

  if (connectionStatus === 'reconnecting') {
    return (
      <div className="conn-banner reconnecting" role="status">
        <RefreshCw size={15} className="spin" />
        <span>Reconnecting&hellip;</span>
      </div>
    );
  }

  if (connectionStatus === 'error') {
    return (
      <div className="conn-banner error" role="status">
        <SignalHigh size={15} />
        <span>Connection lost. Trying to recover.</span>
      </div>
    );
  }

  return null;
}
