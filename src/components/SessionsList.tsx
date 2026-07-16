// src/components/SessionsList.tsx
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { listSessions, restoreMessages, forgetSession, type PersistedSession } from '../lib/storage';
import { useAppStore } from '../store/useAppStore';

export function SessionsList() {
  const [sessions, setSessions] = useState<PersistedSession[]>([]);
  const [loading, setLoading] = useState(true);
  const setStatePartial = useAppStore((s) => s.setStatePartial);
  const pushToast = useAppStore((s) => s.pushToast);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setLoading(true);
    try {
      setSessions(await listSessions());
    } finally {
      setLoading(false);
    }
  }

  async function resume(session: PersistedSession) {
    try {
      const messages = await restoreMessages(session.roomId, session.secret).catch(() => []);
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
    } catch {
      pushToast({ tone: 'error', title: 'Could not resume', message: 'This session could not be restored.' });
    }
  }

  async function remove(roomId: string) {
    await forgetSession(roomId);
    void refresh();
  }

  if (loading || sessions.length === 0) return null;

  return (
    <div className="sessions-list">
      <span className="sessions-list-title">Previous sessions</span>
      {sessions.map((s) => (
        <div key={s.roomId} className="sessions-list-item">
          <button type="button" className="sessions-list-resume" onClick={() => void resume(s)}>
            <span className="sessions-list-room">{s.roomId}</span>
            <span className="sessions-list-meta">
              {s.nickname || 'Anon'} · {new Date(s.lastSeenAt).toLocaleString()}
            </span>
          </button>
          <button
            type="button"
            className="icon-danger-btn"
            aria-label="Forget session"
            onClick={() => void remove(s.roomId)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}