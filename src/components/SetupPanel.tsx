import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  LogIn,
  MessageCircle,
  Plus,
  UserRound,
  Users,
} from 'lucide-react';
import { generateRoomId } from '../lib/roomId';
import { createRoom, joinRoom, SignalError, type RoomType } from '../lib/signaling';
import { persistSession, restoreMessages } from '../lib/storage';
import { useAppStore } from '../store/useAppStore';
import { ThemeToggle } from './ThemeToggle';
import { SessionsList } from './SessionsList';
import type { PlainMessage } from '../types';

type SetupMode = 'home' | 'create-type' | 'create-form' | 'join-form';

export function SetupPanel() {
  const setStatePartial = useAppStore((s) => s.setStatePartial);
  const pushToast = useAppStore((s) => s.pushToast);
  const themeMode = useAppStore((s) => s.themeMode);

  const [mode, setMode] = useState<SetupMode>('home');
  const [nickname, setNickname] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [secret, setSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [selectedType, setSelectedType] = useState<RoomType>('private');

  const title = useMemo(() => {
    if (mode === 'create-type') return 'Create room';
    if (mode === 'create-form') return selectedType === 'group' ? 'Create group room' : 'Create private room';
    if (mode === 'join-form') return 'Join room';
    return 'TempChat';
  }, [mode, selectedType]);

  async function enterRoom(
    roomId: string,
    roomType: RoomType,
    providedSecret: string,
    existingPeerId?: string,
  ) {
    const trimmedRoom = roomId.trim().toLowerCase();
    const trimmedSecret = providedSecret.trim();
    const trimmedName = nickname.trim() || 'Anon';

    if (!trimmedRoom) {
      pushToast({
        tone: 'error',
        title: 'Room ID required',
        message: 'Enter a room ID.',
      });
      return;
    }

    if (!trimmedSecret) {
      pushToast({
        tone: 'error',
        title: 'Password required',
        message: 'Enter the room password.',
      });
      return;
    }

    setLoading(true);

    try {
      const peerId = existingPeerId ?? crypto.randomUUID();

      let messages: PlainMessage[] = [];
      try {
        messages = await restoreMessages(trimmedRoom, trimmedSecret);
      } catch {
        messages = [];
      }

      const joinedRoom = await joinRoom(trimmedRoom, peerId, trimmedName, trimmedSecret);

      setStatePartial({
        roomId: trimmedRoom,
        peerId,
        nickname: trimmedName,
        secret: trimmedSecret,
        connectionStatus: 'joining',
        activeTab: 'chat',
        messages,
        roomFull: false,
        draft: '',
        groupInfo:
          joinedRoom.type === 'group'
            ? {
                roomId: trimmedRoom,
                isGroup: true,
                participants: [],
                maxParticipants: joinedRoom.maxPeers ?? 10,
              }
            : null,
      });

      await persistSession({
        roomId: trimmedRoom,
        peerId,
        nickname: trimmedName,
        secret: trimmedSecret,
        activeTab: 'chat',
        theme: themeMode,
        draft: '',
        lastSeenAt: Date.now(),
      });
    } catch (error) {
      if (error instanceof SignalError && error.code === 'WRONG_PASSWORD') {
        pushToast({
          tone: 'error',
          title: 'Wrong password',
          message: 'The password you entered is incorrect.',
        });
        return;
      }

      if (error instanceof SignalError && error.code === 'ROOM_FULL') {
        pushToast({
          tone: 'error',
          title: 'Room full',
          message:
            roomType === 'group'
              ? 'This group room already has 10 participants.'
              : 'This private room already has 2 participants.',
        });
        return;
      }

      pushToast({
        tone: 'error',
        title: 'Could not join room',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateRoom() {
    const trimmedSecret = secret.trim();
    const trimmedName = nickname.trim() || 'Anon';

    if (!trimmedSecret) {
      pushToast({
        tone: 'error',
        title: 'Password required',
        message: 'Enter a password before creating a room.',
      });
      return;
    }

    setLoading(true);

    const roomId = generateRoomId();
    const peerId = crypto.randomUUID();

    try {
      const createdRoom = await createRoom(roomId, peerId, {
        type: selectedType,
        nickname: trimmedName,
        maxPeers: selectedType === 'group' ? 10 : 2,
        secret: trimmedSecret,
      });

      setRoomIdInput(roomId);

      setStatePartial({
        roomId,
        peerId,
        nickname: trimmedName,
        secret: trimmedSecret,
        connectionStatus: 'joining',
        activeTab: 'chat',
        messages: [],
        roomFull: false,
        draft: '',
        groupInfo:
          createdRoom.type === 'group'
            ? {
                roomId,
                isGroup: true,
                participants: [],
                maxParticipants: createdRoom.maxPeers ?? 10,
              }
            : null,
      });

      await persistSession({
        roomId,
        peerId,
        nickname: trimmedName,
        secret: trimmedSecret,
        activeTab: 'chat',
        theme: themeMode,
        draft: '',
        lastSeenAt: Date.now(),
      });

      pushToast({
        tone: 'success',
        title: 'Room created',
        message: `Room ID: ${roomId}`,
      });
    } catch (error) {
      pushToast({
        tone: 'error',
        title: 'Could not create room',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setLoading(false);
    }
  }

  function goBack() {
    if (loading) return;

    if (mode === 'create-form') {
      setMode('create-type');
      return;
    }

    setMode('home');
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
          <h1>{title}</h1>
          <p>Secure room-based chat with auto-generated room IDs, private rooms, and group rooms.</p>
        </div>

        {mode !== 'home' && (
          <button
            type="button"
            className="setup-back-btn"
            onClick={goBack}
            disabled={loading}
          >
            <ArrowLeft size={16} />
            Back
          </button>
        )}

        {mode === 'home' && (
          <div className="setup-choice-grid">
            <button
              type="button"
              className="setup-circle-btn"
              onClick={() => setMode('join-form')}
              disabled={loading}
            >
              <span className="setup-circle-icon">
                <LogIn size={26} />
              </span>
              <span className="setup-circle-label">Join Room</span>
            </button>

            <button
              type="button"
              className="setup-circle-btn"
              onClick={() => setMode('create-type')}
              disabled={loading}
            >
              <span className="setup-circle-icon">
                <Plus size={26} />
              </span>
              <span className="setup-circle-label">Create Room</span>
            </button>
          </div>
        )}

        {mode === 'create-type' && (
          <div className="setup-choice-grid">
            <button
              type="button"
              className="setup-circle-btn"
              onClick={() => {
                setSelectedType('private');
                setMode('create-form');
              }}
              disabled={loading}
            >
              <span className="setup-circle-icon">
                <UserRound size={26} />
              </span>
              <span className="setup-circle-label">P2P</span>
              <span className="setup-circle-subtext">Only 2 people</span>
            </button>

            <button
              type="button"
              className="setup-circle-btn"
              onClick={() => {
                setSelectedType('group');
                setMode('create-form');
              }}
              disabled={loading}
            >
              <span className="setup-circle-icon">
                <Users size={26} />
              </span>
              <span className="setup-circle-label">Group Chat</span>
              <span className="setup-circle-subtext">Up to 10 people</span>
            </button>
          </div>
        )}

        {mode === 'create-form' && (
          <form
            className="setup-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateRoom();
            }}
          >
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
              <span>Selected type</span>
              <input
                value={selectedType === 'group' ? 'Group chat (max 10)' : 'P2P chat (2 people)'}
                disabled
              />
            </label>

            <label className="setup-field">
              <span>Password</span>
              <div className="setup-password-row">
                <input
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="Set room password"
                  type={showSecret ? 'text' : 'password'}
                  autoComplete="off"
                  aria-label="Room password"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="setup-password-toggle"
                  onClick={() => setShowSecret((v) => !v)}
                  aria-label={showSecret ? 'Hide password' : 'Show password'}
                  title={showSecret ? 'Hide password' : 'Show password'}
                  disabled={loading}
                >
                  {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <button type="submit" className="setup-primary-btn" disabled={loading}>
              {loading ? 'Creating…' : 'Create Room'}
              <ArrowRight size={16} />
            </button>
          </form>
        )}

        {mode === 'join-form' && (
          <form
            className="setup-form"
            onSubmit={(e) => {
              e.preventDefault();
              void enterRoom(roomIdInput, 'private', secret);
            }}
          >
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
              <input
                value={roomIdInput}
                onChange={(e) => setRoomIdInput(e.target.value)}
                placeholder="Enter room ID"
                autoComplete="off"
                aria-label="Room ID"
                disabled={loading}
              />
            </label>

            <label className="setup-field">
              <span>Password</span>
              <div className="setup-password-row">
                <input
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="Enter room password"
                  type={showSecret ? 'text' : 'password'}
                  autoComplete="off"
                  aria-label="Room password"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="setup-password-toggle"
                  onClick={() => setShowSecret((v) => !v)}
                  aria-label={showSecret ? 'Hide password' : 'Show password'}
                  title={showSecret ? 'Hide password' : 'Show password'}
                  disabled={loading}
                >
                  {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            <button type="submit" className="setup-primary-btn" disabled={loading}>
              {loading ? 'Joining…' : 'Join Room'}
              <ArrowRight size={16} />
            </button>
          </form>
        )}

        <SessionsList />
      </div>
    </div>
  );
}