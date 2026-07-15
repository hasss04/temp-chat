import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  MessageCircle,
  Phone,
  PhoneOff,
  Send,
  Trash2,
  Video,
  VideoOff,
} from 'lucide-react';
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
type Status = 'joining' | 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'error';

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function initialsOf(name: string) {
  return (name || 'A').trim().slice(0, 2).toUpperCase();
}

export function SignalBridge() {
  const { roomId, secret, nickname, messages, addMessage, reset, setStatePartial, connected } =
    useAppStore();

  const [draft, setDraft] = useState('');
  const [tab, setTab] = useState<'chat' | 'call'>('chat');
  const [role, setRole] = useState<Role | null>(null);
  const [status, setStatus] = useState<Status>('joining');
  const [restartKey, setRestartKey] = useState(0);
  const [peerTyping, setPeerTyping] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [callConnecting, setCallConnecting] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const peerId = useMemo(() => crypto.randomUUID(), []);
  const appliedIce = useRef<Record<string, number>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const answerAppliedRef = useRef(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localTypingSentRef = useRef(false);
  const peerTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rtc = useWebRTC(
    {
      onChat: (wire) =>
        addMessage({
          id: wire.id,
          sender: 'peer',
          text: wire.text,
          createdAt: wire.createdAt,
        }),
      onTyping: (isTyping) => {
        setPeerTyping(isTyping);
        if (peerTypingTimeoutRef.current) clearTimeout(peerTypingTimeoutRef.current);
        if (isTyping) {
          peerTypingTimeoutRef.current = setTimeout(() => setPeerTyping(false), 4000);
        }
      },
    },
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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, peerTyping]);

  useEffect(() => {
    let myRole: Role | null = null;
    let cancelled = false;

    const onLocal = (e: Event) => {
      const stream = (e as CustomEvent<MediaStream | null>).detail;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream ?? null;
      setInCall(!!stream);
      setCallConnecting(false);
    };
    const onRemote = (e: Event) => {
      const stream = (e as CustomEvent<MediaStream | null>).detail;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream ?? null;
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
          // Once truly connected, signaling is no longer needed — stop polling
          // so a stray network hiccup can never flip the status back to "error".
          if (rtc.getConnectionState() === 'connected') {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            return;
          }
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
            if (!cancelled && rtc.getConnectionState() !== 'connected') {
              setStatus('error');
            }
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
    if (connected) setStatus('connected');
  }, [connected]);

  function handleDraftChange(value: string) {
    setDraft(value);
    if (!localTypingSentRef.current) {
      localTypingSentRef.current = true;
      rtc.send({ kind: 'typing', isTyping: true });
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      localTypingSentRef.current = false;
      rtc.send({ kind: 'typing', isTyping: false });
    }, 1800);
  }

  function sendMessage() {
    const text = draft.trim();
    if (!text) return;
    const id = crypto.randomUUID();
    const createdAt = Date.now();

    addMessage({ id, sender: 'me', text, createdAt });
    rtc.send({ kind: 'chat', id, text, senderName: nickname || 'Anon', createdAt });

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    localTypingSentRef.current = false;
    rtc.send({ kind: 'typing', isTyping: false });

    setDraft('');
  }

  async function toggleCall() {
    if (inCall) {
      rtc.endCall();
      setInCall(false);
      return;
    }
    try {
      setCallConnecting(true);
      await rtc.startCall();
      setMicOn(true);
      setCamOn(true);
    } catch {
      setCallConnecting(false);
    }
  }

  function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    rtc.toggleAudio(next);
  }

  function toggleCam() {
    const next = !camOn;
    setCamOn(next);
    rtc.toggleVideo(next);
  }

  async function killSwitch() {
    rtc.destroy();
    await wipeRoom(roomId).catch(() => {});
    await leaveRoom(roomId, peerId).catch(() => {});
    reset();
  }

  const statusLabel: Record<Status, string> = {
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
                    : status === 'error'
                      ? 'room-status-error'
                      : ''
              }`}
            >
              {statusLabel[status]}
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
        <button type="button" className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
          <MessageCircle size={15} />
          Chat
        </button>
        <button type="button" className={tab === 'call' ? 'active' : ''} onClick={() => setTab('call')}>
          <Video size={15} />
          Call
          {inCall && <span className="live-chip">live</span>}
        </button>
      </nav>

      <div className="room-body">
        <main className={`chat-panel ${tab === 'chat' ? '' : 'hide-on-mobile'}`}>
          <div className="messages">
            {messages.length === 0 && !peerTyping && (
              <div className="empty-state">
                No messages yet. Once your peer connects, everything you send stays only on these two
                devices.
              </div>
            )}

            {messages.map((message, i) => {
              const prev = messages[i - 1];
              const showMeta = !prev || prev.sender !== message.sender;
              const isMe = message.sender === 'me';
              return (
                <div key={message.id} className={`msg-row ${isMe ? 'me' : 'peer'}`}>
                  {!isMe && (
                    <span className={`msg-avatar ${showMeta ? '' : 'ghost'}`}>
                      {showMeta ? initialsOf('Peer') : ''}
                    </span>
                  )}
                  <div className="msg-col">
                    <div className={`bubble ${message.sender}`}>{message.text}</div>
                    <span className="msg-time">{formatTime(message.createdAt)}</span>
                  </div>
                </div>
              );
            })}

            {peerTyping && (
              <div className="msg-row peer">
                <span className="msg-avatar">{initialsOf('Peer')}</span>
                <div className="typing-bubble" aria-label="Peer is typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="composer">
            <input
              value={draft}
              onChange={(e) => handleDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') sendMessage();
              }}
              placeholder="Message"
            />
            <button type="button" onClick={sendMessage} disabled={!draft.trim()} aria-label="Send">
              <Send size={17} />
            </button>
          </div>
        </main>

        <section className={`call-panel ${tab === 'call' ? '' : 'hide-on-mobile'}`}>
          <div className={`call-stage ${inCall ? 'active' : ''}`}>
            <video ref={remoteVideoRef} className="remote-video" autoPlay playsInline />
            {!connected && (
              <div className="call-placeholder">
                <Video size={22} />
                <span>Waiting for your peer to connect…</span>
              </div>
            )}
            {connected && !inCall && (
              <div className="call-placeholder">
                <Video size={22} />
                <span>Start your camera to begin a call</span>
              </div>
            )}
            <div className={`local-video-pip ${inCall ? '' : 'hidden'}`}>
              <video ref={localVideoRef} autoPlay muted playsInline />
            </div>
          </div>

          <div className="call-controls">
            {!inCall ? (
              <button
                type="button"
                className="call-btn primary"
                onClick={toggleCall}
                disabled={!connected || callConnecting}
              >
                <Phone size={16} />
                {callConnecting ? 'Connecting…' : 'Start call'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={`call-icon-btn ${micOn ? '' : 'off'}`}
                  onClick={toggleMic}
                  aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
                  title={micOn ? 'Mute' : 'Unmute'}
                >
                  {micOn ? <Mic size={17} /> : <MicOff size={17} />}
                </button>
                <button
                  type="button"
                  className={`call-icon-btn ${camOn ? '' : 'off'}`}
                  onClick={toggleCam}
                  aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
                  title={camOn ? 'Camera off' : 'Camera on'}
                >
                  {camOn ? <Video size={17} /> : <VideoOff size={17} />}
                </button>
                <button
                  type="button"
                  className="call-icon-btn danger"
                  onClick={toggleCall}
                  aria-label="End call"
                  title="End call"
                >
                  <PhoneOff size={17} />
                </button>
              </>
            )}
          </div>
        </section>
      </div>

      <button type="button" className="leave-link" onClick={() => setStatePartial({ roomId: '' })}>
        ← Leave room
      </button>
    </div>
  );
}