import { useState } from 'react';
import { MessageCircle, ArrowRight, Shuffle } from 'lucide-react';
import { generateRoomId } from '../lib/roomId';
import { createRoom } from '../lib/signaling';
import { persistSession, restoreMessages } from '../lib/storage';
import { useAppStore } from '../store/useAppStore';
import { ThemeToggle } from './ThemeToggle';

export function SetupPanel() {
  const setStatePartial = useAppStore((s) => s.setStatePartial);
  const pushToast = useAppStore((s) => s.pushToast);
  const themeMode = useAppStore((s) => s.themeMode);

  const [nickname, setNickname] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [secret, setSecret] = useState('');
  const [loading, setLoading] = useState(false);

  async function enterRoom(roomId: string, roomType: 'private' | 'group' = 'private') {
    const trimmedRoom = roomId.trim().toLowerCase();
    const trimmedSecret = secret.trim();
    const trimmedName = nickname.trim() || 'Anon';

    if (!trimmedRoom) {
      pushToast({
        tone: 'error',
        title: 'Room ID required',
        message: 'Enter or generate a room ID first.',
      });
      return;
    }

    if (!trimmedSecret) {
      pushToast({
        tone: 'error',
        title: 'Passphrase required',
        message: 'Enter a shared passphrase to encrypt this room.',
      });
      return;
    }

    setLoading(true);

    try {
      const messages = await restoreMessages(trimmedRoom, trimmedSecret).catch(() => []);

      setStatePartial({
        roomId: trimmedRoom,
        nickname: trimmedName,
        secret: trimmedSecret,
        connectionStatus: 'joining',
        activeTab: 'chat',
        messages,
        roomFull: false,
        draft: '',
        groupInfo:
          roomType === 'group'
            ? {
                roomId: trimmedRoom,
                isGroup: true,
                participants: [],
                maxParticipants: 12,
              }
            : null,
      });

      await persistSession({
        roomId: trimmedRoom,
        nickname: trimmedName,
        secret: trimmedSecret,
        activeTab: 'chat',
        theme: themeMode,
        draft: '',
        lastSeenAt: Date.now(),
      });
    } catch (error) {
      pushToast({
        tone: 'error',
        title: 'Could not enter room',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  }

  function handleRandomize() {
    setRoomIdInput(generateRoomId());
  }

  async function handleCreateAndJoin() {
    const roomId = generateRoomId();
    const trimmedSecret = secret.trim();
    const trimmedName = nickname.trim() || 'Anon';

    if (!trimmedSecret) {
      pushToast({
        tone: 'error',
        title: 'Passphrase required',
        message: 'Enter a shared passphrase before creating a new room.',
      });
      return;
    }

    setRoomIdInput(roomId);
    setLoading(true);

    try {
      await createRoom(roomId, crypto.randomUUID(), {
        type: 'group',
        nickname: trimmedName,
        maxPeers: 12,
      });

      await enterRoom(roomId, 'group');
    } catch (error) {
      setLoading(false);
      pushToast({
        tone: 'error',
        title: 'Could not create room',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    void enterRoom(roomIdInput, 'private');
  }

  return (
    <div className="setup-shell">
      <div className="setup-topbar">
        <ThemeToggle />
      </div>

      <div className="setup-card">
        <div className="setup-brand">
          <div className="setup-brand-icon">
            <MessageCircle size={22} />
          </div>
          <h1>TempChat</h1>
          <p>End-to-end encrypted peer-to-peer messaging. Nothing is stored on a server.</p>
        </div>

        <form className="setup-form" onSubmit={handleJoin}>
          <label className="setup-field">
            <span>Display name</span>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Anonymous"
              maxLength={24}
              autoComplete="off"
              aria-label="Display name"
              disabled={loading}
            />
          </label>

          <label className="setup-field">
            <span>Room ID</span>
            <div className="setup-room-row">
              <input
                value={roomIdInput}
                onChange={(e) => setRoomIdInput(e.target.value)}
                placeholder="zelith-korven-482"
                autoComplete="off"
                aria-label="Room ID"
                disabled={loading}
              />
              <button
                type="button"
                className="setup-randomize-btn"
                onClick={handleRandomize}
                aria-label="Randomize room ID"
                title="Randomize room ID"
                disabled={loading}
              >
                <Shuffle size={15} />
              </button>
            </div>
          </label>

          <label className="setup-field">
            <span>Passphrase</span>
            <input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Shared encryption passphrase"
              type="password"
              autoComplete="off"
              aria-label="Encryption passphrase"
              disabled={loading}
            />
          </label>

          <button type="submit" className="setup-primary-btn" disabled={loading}>
            {loading ? 'Joining…' : 'Join room'}
            <ArrowRight size={16} />
          </button>
        </form>

        <div className="setup-divider">
          <span>or</span>
        </div>

        <button
          type="button"
          className="setup-secondary-btn"
          onClick={() => void handleCreateAndJoin()}
          disabled={loading}
        >
          {loading ? 'Creating…' : 'Create a new room'}
        </button>
      </div>
    </div>
  );
}