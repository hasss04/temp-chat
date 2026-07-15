import { SignalBridge } from './components/SignalBridge';
import { SetupPanel } from './components/SetupPanel';
import { useAppStore } from './store/useAppStore';

export default function App() {
  const roomId = useAppStore((s) => s.roomId);
  return <div className="app-shell">{roomId ? <SignalBridge /> : <SetupPanel />}</div>;
}
