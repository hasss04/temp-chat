import { FormEvent, useState } from 'react';
import { ArrowRight, Dices, Lock } from 'lucide-react';
import { restoreMessages } from '../lib/storage';
import { generateRoomId } from '../lib/roomId';
import { useAppStore } from '../store/useAppStore';

export function SetupPanel() {
  const setStatePartial = useAppStore((s) => s.setStatePartial);
  const [roomId, setRoomId] = useState('');
  const [nickname, setNickname] = useState('');
  const [secret, setSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const messages = await restoreMessages(roomId.trim(), secret.trim()).catch(() => []);
      setStatePartial({
        roomId: roomId.trim(),
        nickname: nickname.trim() || 'Anon',
        secret: secret.trim(),
        messages
      });
    } catch {
      setError('Could not open that room. Check the room ID and secret.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="setup-shell">
      <div className="setup-mark">
        <span className="setup-mark-dot" />
        <span className="setup-mark-dot" />
      </div>
      <h1 className="setup-title">TempChat</h1>
      <p className="setup-sub">
        Peer-to-peer chat and calls. Nothing touches a server — your history is
        encrypted with a secret only you and the other person know.
      </p>

      <form className="setup-form" onSubmit={submit}>
        <div className="field-group">
          <label htmlFor="roomId">Room ID</label>
          <div className="room-id-row">
            <input
              id="roomId"
              name="roomId"
              type="text"
              inputMode="text"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              className="mono-input"
              placeholder="quiet-harbor-42"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              required
            />
            <button
              type="button"
              className="dice-btn"
              title="Generate a room ID"
              onClick={() => setRoomId(generateRoomId())}
            >
              <Dices size={18} />
            </button>
          </div>
        </div>

        <div className="field-row">
          <div className="field-group">
            <label htmlFor="nickname">Name</label>
            <input
              id="nickname"
              name="nickname"
              type="text"
              autoComplete="nickname"
              placeholder="Anon"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </div>
          <div className="field-group">
            <label htmlFor="secret">Shared secret</label>
            <input
              id="secret"
              name="secret"
              type="password"
              autoComplete="new-password"
              placeholder="Only you two know this"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              required
            />
          </div>
        </div>

        {error && <p className="setup-error">{error}</p>}

        <button className="setup-submit" type="submit" disabled={loading}>
          <span>{loading ? 'Opening…' : 'Enter room'}</span>
          <ArrowRight size={17} />
        </button>

        <p className="setup-footnote">
          <Lock size={13} />
          Same room ID and secret on both devices — that's the whole handshake.
        </p>
      </form>
    </section>
  );
}