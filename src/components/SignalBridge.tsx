import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Phone, Trash2, Video } from 'lucide-react';
import {
  determineRole,
  getRoom,
  joinRoom,
  leaveRoom,
  postAnswer,
  postIce,
  postOffer,
} from '../lib/signaling';
import { persistMessages, wipeRoom } from '../lib/storage';
import { useAppStore } from '../store/useAppStore';
import { useWebRTC } from '../hooks/useWebRTC';
import { useVisibilityReconnect } from '../hooks/useVisibilityReconnect';

type Role = 'offerer' | 'answerer';

export function SignalBridge() {
  const {
    roomId,
    secret,
    nickname,
    messages,
    addMessage,
    reset,
    setStatePartial,
    connected,
  } = useAppStore();

  const [draft, setDraft] = useState('');
  const [tab, setTab] = useState<'chat' | 'call'>('chat');
  const [role, setRole] = useState<Role | null>(null);
  const [status, setStatus] = useState<
    'joining' | 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'error'
  >('joining');
  const [restartKey, setRestartKey] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerId = useMemo(() => crypto.randomUUID(), []);
  const appliedIce = useRef<Record<string, number>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const answerAppliedRef = useRef(false);

  const rtc = useWebRTC(
    (text) =>
      addMessage({
        id: crypto.randomUUID(),
        sender: 'peer',
        text,
        createdAt: Date.now(),
      }),
    restartKey,
  );

  useVisibilityReconnect(
    () => rtc.getConnectionState(),
    () => {
      setStatus('reconnecting');
      answerAppliedRef.current = false;
      appliedIce.current = {};
      setRestartKey((k) => k + 1);
    },
  );

  useEffect(() => {
    persistMessages(roomId, secret, messages).catch(() => {});
  }, [messages, roomId, secret]);

  useEffect(() => {
    let myRole: Role | null = null;
    let cancelled = false;

    const onLocal = (e: Event) => {
      const stream = (e as CustomEvent<MediaStream | null>).detail;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream ?? null;
      }
    };

    const onRemote = (e: Event) => {
      const stream = (e as CustomEvent<MediaStream | null>).detail;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream ?? null;
      }
    };

    window.addEventListener('tempchat:local-stream', onLocal as EventListener);
    window.addEventListener('tempchat:remote-stream', onRemote as EventListener);

    const offIce = rtc.onIceCandidate((candidate) => {
      postIce(roomId, peerId, candidate.toJSON()).catch(() => {});
    });

    (async () => {
      try {
        if (restartKey > 0) {
          await leaveRoom(roomId, peerId).catch(() => {});
        }

        await joinRoom(roomId, peerId).catch(() => {});
        myRole = await determineRole(roomId, peerId);

        if (cancelled) return;
        setRole(myRole);

        if (myRole === 'offerer') {
          setStatus('waiting');
          const offer = await rtc.createLocalOffer();
          await postOffer(roomId, peerId, offer);
        } else {
          setStatus('connecting');
          const room = await getRoom(roomId);
          if (room.offer) {
            const answer = await rtc.acceptRemoteOffer(JSON.parse(room.offer));
            await postAnswer(roomId, peerId, answer);
            answerAppliedRef.current = true;
          }
        }

        pollRef.current = setInterval(async () => {
          try {
            const room = await getRoom(roomId);

            if (myRole === 'answerer' && !answerAppliedRef.current && room.offer) {
              const answer = await rtc.acceptRemoteOffer(JSON.parse(room.offer));
              await postAnswer(roomId, peerId, answer);
              answerAppliedRef.current = true;
            }

            if (myRole === 'offerer' && room.answer && !connected) {
              await rtc.acceptRemoteAnswer(JSON.parse(room.answer));
            }

            for (const [otherId, candidates] of Object.entries(room.ice ?? {})) {
              if (otherId === peerId) continue;

              const applied = appliedIce.current[otherId] ?? 0;
              for (let i = applied; i < candidates.length; i++) {
                await rtc.addIceCandidate(JSON.parse(candidates[i]));
              }
              appliedIce.current[otherId] = candidates.length;
            }
          } catch {
            if (!cancelled) setStatus('error');
          }
        }, 1500);
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      offIce();

      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }

      window.removeEventListener('tempchat:local-stream', onLocal as EventListener);
      window.removeEventListener('tempchat:remote-stream', onRemote as EventListener);

      leaveRoom(roomId, peerId).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerId, roomId, restartKey]);

  useEffect(() => {
    if (connected) {
      setStatus('connected');
    }
  }, [connected]);

  function sendMessage() {
    if (!draft.trim()) return;

    const text = `${nickname || 'Anon'}: ${draft.trim()}`;
    const message = {
      id: crypto.randomUUID(),
      sender: 'me' as const,
      text,
      createdAt: Date.now(),
    };

    addMessage(message);
    rtc.sendText(message.text);
    setDraft('');
  }

  async function killSwitch() {
    rtc.destroy();
    await wipeRoom(roomId).catch(() => {});
    await leaveRoom(roomId, peerId).catch(() => {});
    reset();
  }

  const statusLabel: Record<string, string> = {
    joining: 'Joining room…',
    waiting: 'Waiting for the other device…',
    connecting: 'Connecting…',
    connected: 'Connected',
    reconnecting: 'Reconnecting…',
    error: 'Connection error. Try rejoining.',
  };

  return (
    <div className="room-shell">
      <header className="room-bar">
        <div className="room-bar-left">
          <div className="link-indicator" aria-hidden="true">
            <span className={`link-dot ${role ? 'set' : ''}`} />
            <span className={`link-line ${status === 'connected' ? 'live' : ''}`} />
            <span className={`link-dot ${connected ? 'set' : ''}`} />
          </div>

          <div>
            <p className="room-id-label">{roomId}</p>
            <p
              className={`room-status ${
                status === 'connected'
                  ? 'room-status-connected'
                  : status === 'reconnecting'
                    ? 'room-status-reconnecting'
                    : ''
              }`}
            >
              {statusLabel[status] ?? status}
            </p>
          </div>
        </div>

        <button
          type="button"
          className="kill-btn"
          onClick={killSwitch}
          title="Wipe room and leave"
          aria-label="Wipe room and leave"
        >
          <Trash2 size={16} />
        </button>
      </header>

      <nav className="tab-bar" aria-label="Room sections">
        <button
          type="button"
          className={tab === 'chat' ? 'active' : ''}
          onClick={() => setTab('chat')}
        >
          <MessageCircle size={15} />
          Chat
        </button>

        <button
          type="button"
          className={tab === 'call' ? 'active' : ''}
          onClick={() => setTab('call')}
        >
          <Video size={15} />
          Call
        </button>
      </nav>

      <div className="room-body">
        <main className={`chat-panel ${tab === 'chat' ? '' : 'hide-on-mobile'}`}>
          <div className="messages">
            {messages.map((message) => (
              <div key={message.id} className={`bubble ${message.sender}`}>
                {message.text}
              </div>
            ))}

            {messages.length === 0 && (
              <div className="empty-state">
                No messages yet. Once your peer connects, everything you send stays only on these two
                devices.
              </div>
            )}
          </div>

          <div className="composer">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') sendMessage();
              }}
              placeholder="Message"
            />
            <button type="button" onClick={sendMessage}>
              Send
            </button>
          </div>
        </main>

        <section className={`call-panel ${tab === 'call' ? '' : 'hide-on-mobile'}`}>
          <button type="button" className="call-start" onClick={() => rtc.startCall()}>
            <Phone size={16} />
            Start camera & mic
          </button>

          <div className="video-wrap">
            <div className="video-tile">
              <video ref={localVideoRef} autoPlay muted playsInline />
              <span className="video-label">You</span>
            </div>

            <div className="video-tile">
              <video ref={remoteVideoRef} autoPlay playsInline />
              <span className="video-label">Peer</span>
            </div>
          </div>
        </section>
      </div>

      <button
        type="button"
        className="leave-link"
        onClick={() => setStatePartial({ roomId: '' })}
      >
        ← Leave room
      </button>
    </div>
  );
}