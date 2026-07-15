import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, Phone, Video, WifiOff, Users } from 'lucide-react';
import {
  SignalError,
  determineRole,
  getRoom,
  joinRoom,
  leaveRoom,
  postAnswer,
  postIce,
  postOffer,
} from '../lib/signaling';
import { clearPersistedSession, persistMessages, persistSession, wipeRoom } from '../lib/storage';
import { useAppStore } from '../store/useAppStore';
import { useWebRTC } from '../hooks/useWebRTC';
import { useVisibilityReconnect } from '../hooks/useVisibilityReconnect';
import { ChatView } from './ChatView';
import { ThemeToggle } from './ThemeToggle';
import { VoiceCallView } from './VoiceCallView';
import { VideoCallView } from './VideoCallView';
import type { CallPhase, CallQuality, CallType } from '../types';

type Role = 'offerer' | 'answerer';

function initialsOf(name: string) {
  return (name || 'A').trim().slice(0, 2).toUpperCase();
}

export function SignalBridge() {
  const roomId = useAppStore((s) => s.roomId);
  const secret = useAppStore((s) => s.secret);
  const nickname = useAppStore((s) => s.nickname);
  const messages = useAppStore((s) => s.messages);
  const addMessage = useAppStore((s) => s.addMessage);
  const markMessageDelivered = useAppStore((s) => s.markMessageDelivered);
  const markMessageSeen = useAppStore((s) => s.markMessageSeen);
  const reset = useAppStore((s) => s.reset);
  const setStatePartial = useAppStore((s) => s.setStatePartial);
  const connected = useAppStore((s) => s.connected);
  const activeTab = useAppStore((s) => s.activeTab);
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const pushToast = useAppStore((s) => s.pushToast);
  const themeMode = useAppStore((s) => s.themeMode);
  const isOnline = useAppStore((s) => s.isOnline);
  const draft = useAppStore((s) => s.draft);
  const setDraft = useAppStore((s) => s.setDraft);
  const groupInfo = useAppStore((s) => s.groupInfo);
  const setGroupInfo = useAppStore((s) => s.setGroupInfo);
  const setParticipants = useAppStore((s) => s.setParticipants);
  const participants = useAppStore((s) => s.participants);

  const [role, setRole] = useState<Role | null>(null);
  const [restartKey, setRestartKey] = useState(0);
  const [peerTyping, setPeerTyping] = useState(false);

  const [callType, setCallType] = useState<CallType | null>(null);
  const [callPhase, setCallPhase] = useState<CallPhase>('idle');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [headphonesOn, setHeadphonesOn] = useState(false);
  const [onHold, setOnHold] = useState(false);
  const [blurOn, setBlurOn] = useState(false);
  const [callQuality, setCallQuality] = useState<CallQuality>('unknown');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const peerId = useMemo(() => crypto.randomUUID(), []);
  const appliedIce = useRef<Record<string, number>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const answerAppliedRef = useRef(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localTypingSentRef = useRef(false);
  const draftPersistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCallInitiatorRef = useRef(false);
  const joinedRef = useRef(false);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);

  const rtcApi = useWebRTC(
    {
      onChat: (wire) => {
        addMessage({ id: wire.id, sender: 'peer', text: wire.text, createdAt: wire.createdAt });
        rtcApiRef.current.send({
          kind: 'receipt',
          messageId: wire.id,
          receipt: 'delivered',
          at: Date.now(),
        });

        if (document.visibilityState === 'visible' && activeTab === 'chat') {
          rtcApiRef.current.send({
            kind: 'receipt',
            messageId: wire.id,
            receipt: 'seen',
            at: Date.now(),
          });
        }
      },
      onTyping: (isTyping) => {
        setPeerTyping(isTyping);
        if (peerTypingTimeoutRef.current) clearTimeout(peerTypingTimeoutRef.current);
        if (isTyping) {
          peerTypingTimeoutRef.current = setTimeout(() => setPeerTyping(false), 3500);
        }
      },
      onReceipt: (receipt) => {
        if (receipt.receipt === 'delivered') {
          markMessageDelivered(receipt.messageId, receipt.at);
        } else {
          markMessageSeen(receipt.messageId, receipt.at);
        }
      },
      onCallSignal: (wire) => {
        if (groupInfo?.isGroup) {
          pushToast({
            tone: 'info',
            title: 'Group call unavailable',
            message: 'Calls are currently supported only in private rooms.',
          });
          return;
        }

        if (wire.kind === 'call-invite') {
          isCallInitiatorRef.current = false;
          setCallType(wire.callType ?? 'voice');
          setCallPhase('incoming');
        } else if (wire.kind === 'call-accept') {
          setCallPhase('connecting');
          void (async () => {
            await rtcApiRef.current.acquireCallMedia(wire.callType ?? callType ?? 'voice');
            if (isCallInitiatorRef.current) {
              await rtcApiRef.current.renegotiate();
            }
            setCallPhase('active');
          })();
        } else if (wire.kind === 'call-reject') {
          pushToast({
            tone: 'info',
            title: 'Call declined',
            message: 'The other person declined the call.',
          });
          resetCallState();
        } else if (wire.kind === 'call-end') {
          resetCallState();
        } else if (wire.kind === 'call-hold') {
          setOnHold(!!wire.onHold);
        }
      },
    },
    restartKey,
  );

  const rtcApiRef = useRef(rtcApi);
  rtcApiRef.current = rtcApi;

  const resetCallState = useCallback(() => {
    rtcApiRef.current.endCall();
    isCallInitiatorRef.current = false;
    setCallPhase('idle');
    setCallType(null);
    setOnHold(false);
    setBlurOn(false);
    setMicOn(true);
    setCamOn(true);
    setSpeakerOn(true);
    setHeadphonesOn(false);
  }, []);

  useVisibilityReconnect(
    () => rtcApi.getConnectionState(),
    () => {
      if (connectionStatus === 'reconnecting' || connectionStatus === 'joining') return;
      setStatePartial({ connectionStatus: 'reconnecting' });
      pushToast({
        tone: 'info',
        title: 'Reconnecting',
        message: 'Trying to restore the connection.',
      });
      answerAppliedRef.current = false;
      appliedIce.current = {};
      joinedRef.current = false;
      pendingIceRef.current = [];
      setRestartKey((k) => k + 1);
    },
  );

  useEffect(() => {
    if (!roomId || !secret) return;
    persistMessages(roomId, secret, messages).catch(() => {});
  }, [messages, roomId, secret]);

  useEffect(() => {
    if (!roomId || !secret) return;
    persistSession({
      roomId,
      nickname,
      secret,
      activeTab,
      theme: themeMode,
      draft,
      lastSeenAt: Date.now(),
    }).catch(() => {});
  }, [roomId, nickname, secret, activeTab, themeMode, draft]);

  useEffect(() => {
    if (!roomId || !secret) return;
    if (draftPersistTimeoutRef.current) clearTimeout(draftPersistTimeoutRef.current);

    draftPersistTimeoutRef.current = setTimeout(() => {
      persistSession({
        roomId,
        nickname,
        secret,
        activeTab,
        theme: themeMode,
        draft,
        lastSeenAt: Date.now(),
      }).catch(() => {});
    }, 400);

    return () => {
      if (draftPersistTimeoutRef.current) clearTimeout(draftPersistTimeoutRef.current);
    };
  }, [draft, roomId, secret, nickname, activeTab, themeMode]);

  useEffect(() => {
    let myRole: Role | null = null;
    let cancelled = false;

    joinedRef.current = false;
    pendingIceRef.current = [];
    answerAppliedRef.current = false;
    appliedIce.current = {};

    const onLocal = (e: Event) => {
      const stream = (e as CustomEvent<MediaStream | null>).detail;
      setLocalStream(stream ?? null);
    };

    const onRemote = (e: Event) => {
      const stream = (e as CustomEvent<MediaStream | null>).detail;
      setRemoteStream(stream ?? null);
    };

    window.addEventListener('tempchat:local-stream', onLocal as EventListener);
    window.addEventListener('tempchat:remote-stream', onRemote as EventListener);

    const offIce = rtcApi.onIceCandidate((candidate) => {
      const init = candidate.toJSON();
      if (joinedRef.current) {
        postIce(roomId, peerId, init).catch(() => {});
      } else {
        pendingIceRef.current.push(init);
      }
    });

    function flushPendingIce() {
      const queued = pendingIceRef.current;
      pendingIceRef.current = [];
      for (const init of queued) {
        postIce(roomId, peerId, init).catch(() => {});
      }
    }

    void (async () => {
      try {
        setStatePartial({
          connectionStatus: restartKey > 0 ? 'reconnecting' : 'joining',
          roomFull: false,
        });

        if (restartKey > 0) {
          await leaveRoom(roomId, peerId).catch(() => {});
        }

        const joinedRoom = await joinRoom(roomId, peerId, nickname);
        joinedRef.current = true;
        flushPendingIce();

        const roomType = joinedRoom.type ?? 'private';
        const roomParticipants =
          joinedRoom.participants?.map((p) => ({
            peerId: p.peerId,
            nickname: p.nickname || 'Anon',
            status: 'online' as const,
            joinedAt: p.joinedAt,
          })) ?? [];

        setParticipants(roomParticipants);

        if (roomType === 'group') {
          setGroupInfo({
            roomId,
            isGroup: true,
            participants: roomParticipants,
            maxParticipants: joinedRoom.maxPeers ?? 12,
          });
          setStatePartial({ connectionStatus: 'connected', connected: true });
          return;
        }

        setGroupInfo(null);

        myRole = await determineRole(roomId, peerId);
        if (cancelled) return;
        setRole(myRole);

        if (myRole === 'offerer') {
          setStatePartial({ connectionStatus: 'waiting' });
          const offer = await rtcApi.createLocalOffer();
          await postOffer(roomId, peerId, offer);
        } else {
          setStatePartial({ connectionStatus: 'connecting' });
          const room = await getRoom(roomId);
          if (room.offer) {
            const answer = await rtcApi.acceptRemoteOffer(JSON.parse(room.offer));
            await postAnswer(roomId, peerId, answer);
            answerAppliedRef.current = true;
          }
        }

        pollRef.current = setInterval(async () => {
          if (groupInfo?.isGroup) return;

          if (rtcApi.getConnectionState() === 'connected') {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            return;
          }

          try {
            const room = await getRoom(roomId);

            if (myRole === 'answerer' && !answerAppliedRef.current && room.offer) {
              const answer = await rtcApi.acceptRemoteOffer(JSON.parse(room.offer));
              await postAnswer(roomId, peerId, answer);
              answerAppliedRef.current = true;
            }

            if (myRole === 'offerer' && room.answer && !connected) {
              await rtcApi.acceptRemoteAnswer(JSON.parse(room.answer));
            }

            for (const [otherId, candidates] of Object.entries(room.ice ?? {})) {
              if (otherId === peerId) continue;
              const applied = appliedIce.current[otherId] ?? 0;
              for (let i = applied; i < candidates.length; i++) {
                await rtcApi.addIceCandidate(JSON.parse(candidates[i]));
              }
              appliedIce.current[otherId] = candidates.length;
            }
          } catch (error) {
            if (error instanceof SignalError && error.code === 'ROOM_FULL') {
              if (!cancelled) {
                setStatePartial({ connectionStatus: 'error', roomFull: true });
                pushToast({
                  tone: 'error',
                  title: 'Room full',
                  message: 'This room is currently occupied. Please wait until one participant leaves.',
                });
              }
              return;
            }

            if (!cancelled && rtcApi.getConnectionState() !== 'connected') {
              setStatePartial({ connectionStatus: 'error' });
            }
          }
        }, 1200);
      } catch (error) {
        if (cancelled) return;

        setStatePartial({ connectionStatus: 'error' });

        if (error instanceof SignalError && error.code === 'ROOM_FULL') {
          await clearPersistedSession().catch(() => {});
          setStatePartial({
            roomId: '',
            nickname: '',
            secret: '',
            connected: false,
            connectionStatus: 'idle',
            activeTab: 'chat',
            groupInfo: null,
            participants: [],
          });
          pushToast({
            tone: 'error',
            title: 'Room full',
            message: 'This room is currently occupied. Please try another session.',
          });
          return;
        }

        pushToast({
          tone: 'error',
          title: 'Connection failed',
          message: 'Could not join the room. Please retry.',
        });
      }
    })();

    return () => {
      cancelled = true;
      offIce();

      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }

      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (peerTypingTimeoutRef.current) clearTimeout(peerTypingTimeoutRef.current);

      window.removeEventListener('tempchat:local-stream', onLocal as EventListener);
      window.removeEventListener('tempchat:remote-stream', onRemote as EventListener);

      joinedRef.current = false;
      pendingIceRef.current = [];
      leaveRoom(roomId, peerId).catch(() => {});
    };
  }, [connected, peerId, pushToast, roomId, restartKey, setStatePartial, nickname, rtcApi, setGroupInfo, setParticipants]);

  useEffect(() => {
    if (connected) setStatePartial({ connectionStatus: 'connected' });
  }, [connected, setStatePartial]);

  useEffect(() => {
    function markVisibleMessagesSeen() {
      if (!connected || activeTab !== 'chat' || document.visibilityState !== 'visible') return;

      messages
        .filter((msg) => msg.sender === 'peer' && !msg.seenAt)
        .forEach((msg) => {
          rtcApi.send({
            kind: 'receipt',
            messageId: msg.id,
            receipt: 'seen',
            at: Date.now(),
          });
        });
    }

    markVisibleMessagesSeen();
    document.addEventListener('visibilitychange', markVisibleMessagesSeen);
    window.addEventListener('focus', markVisibleMessagesSeen);

    return () => {
      document.removeEventListener('visibilitychange', markVisibleMessagesSeen);
      window.removeEventListener('focus', markVisibleMessagesSeen);
    };
  }, [messages, connected, activeTab, rtcApi]);

  useEffect(() => {
    if (callPhase !== 'active') return;
    const id = window.setInterval(async () => {
      setCallQuality(await rtcApi.getCallQuality());
    }, 3000);
    return () => window.clearInterval(id);
  }, [callPhase, rtcApi]);

  function stopTypingSignal() {
    if (!localTypingSentRef.current) return;
    localTypingSentRef.current = false;
    rtcApi.send({ kind: 'typing', isTyping: false });
  }

  function handleDraftChange(value: string) {
    setDraft(value);

    if (groupInfo?.isGroup) return;
    if (!connected || !rtcApi.isDataChannelOpen()) return;

    if (value.trim() && !localTypingSentRef.current) {
      localTypingSentRef.current = true;
      rtcApi.send({ kind: 'typing', isTyping: true });
    }

    if (!value.trim()) {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      stopTypingSignal();
      return;
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => stopTypingSignal(), 1500);
  }

  function sendMessage() {
    const text = draft.trim();
    if (!text) return;

    const id = crypto.randomUUID();
    const createdAt = Date.now();

    addMessage({ id, sender: 'me', text, createdAt });

    if (!groupInfo?.isGroup) {
      if (!connected) return;
      rtcApi.send({ kind: 'chat', id, text, senderName: nickname || 'Anon', createdAt });
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      stopTypingSignal();
    }

    setDraft('');
  }

  function startCall(type: CallType) {
    if (groupInfo?.isGroup) {
      pushToast({
        tone: 'info',
        title: 'Unavailable in group room',
        message: 'Calls are currently supported only in private rooms.',
      });
      return;
    }

    if (!connected || callPhase !== 'idle') return;
    isCallInitiatorRef.current = true;
    setCallType(type);
    setCallPhase('outgoing');
    rtcApi.send({ kind: 'call-invite', callType: type });
  }

  async function acceptCall() {
    if (!callType) return;
    setCallPhase('connecting');

    try {
      await rtcApi.acquireCallMedia(callType);
      rtcApi.send({ kind: 'call-accept', callType });
      setCallPhase('active');
    } catch {
      pushToast({
        tone: 'error',
        title: 'Permission denied',
        message: 'Allow microphone and camera access to accept the call.',
      });
      rtcApi.send({ kind: 'call-reject' });
      resetCallState();
    }
  }

  function rejectCall() {
    rtcApi.send({ kind: 'call-reject' });
    resetCallState();
  }

  function endCall() {
    rtcApi.send({ kind: 'call-end' });
    resetCallState();
  }

  function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    rtcApi.toggleAudio(next);
  }

  function toggleCam() {
    const next = !camOn;
    setCamOn(next);
    rtcApi.toggleVideo(next);
  }

  function toggleHold() {
    const next = !onHold;
    setOnHold(next);
    rtcApi.toggleAudio(!next && micOn);
    rtcApi.send({ kind: 'call-hold', onHold: next });
  }

  async function killSwitch() {
    rtcApi.destroy();
    await wipeRoom(roomId).catch(() => {});
    await clearPersistedSession().catch(() => {});
    await leaveRoom(roomId, peerId).catch(() => {});
    reset();
    pushToast({
      tone: 'success',
      title: 'Room cleared',
      message: 'Chat history and session removed from this device.',
    });
  }

  async function leaveRoomOnly() {
    rtcApi.destroy();
    await clearPersistedSession().catch(() => {});
    await leaveRoom(roomId, peerId).catch(() => {});
    setStatePartial({
      roomId: '',
      nickname: '',
      secret: '',
      connected: false,
      connectionStatus: 'idle',
      activeTab: 'chat',
      messages: [],
      draft: '',
      groupInfo: null,
      participants: [],
    });
  }

  const statusLabel: Record<string, string> = {
    idle: 'Ready',
    joining: 'Joining…',
    waiting: 'Waiting…',
    connecting: 'Connecting…',
    connected: 'Online',
    reconnecting: 'Reconnecting…',
    error: 'Error',
  };

  const peerStatus =
    groupInfo?.isGroup
      ? `${participants.length}/${groupInfo.maxParticipants} participants`
      : connectionStatus === 'connected'
        ? 'Secure peer-to-peer connection'
        : connectionStatus === 'waiting'
          ? 'Waiting for the other person'
          : statusLabel[connectionStatus];

  const callActive = callPhase !== 'idle';

  return (
    <div className="room-shell">
      {!isOnline && (
        <div className="banner banner-offline" role="status">
          <WifiOff size={14} />
          <span>You&apos;re offline. Messages will send once your connection returns.</span>
        </div>
      )}

      {isOnline && connectionStatus === 'reconnecting' && (
        <div className="banner banner-reconnect" role="status">
          <span className="banner-dot" />
          <span>Reconnecting to your peer&hellip;</span>
        </div>
      )}

      <header className="room-header">
        <div className="room-header-main">
          <div className="room-avatar">
            {groupInfo?.isGroup ? <Users size={16} /> : initialsOf('Peer')}
          </div>

          <div className="room-meta">
            <div className="room-meta-top">
              <p className="room-peer-name">{groupInfo?.isGroup ? 'Group room' : 'Private room'}</p>
              <span
                className={`status-pill ${
                  connectionStatus === 'connected'
                    ? 'online'
                    : connectionStatus === 'reconnecting'
                      ? 'warn'
                      : connectionStatus === 'error'
                        ? 'error'
                        : ''
                }`}
              >
                {statusLabel[connectionStatus]}
              </span>
            </div>

            <p className="room-subline">
              <span className="room-id-label">{roomId}</span>
              <span className="room-sep">&middot;</span>
              <span>{peerStatus}</span>
            </p>
          </div>
        </div>

        <div className="room-header-actions">
          <ThemeToggle />

          <button
            type="button"
            className="icon-action-btn"
            onClick={() => startCall('voice')}
            disabled={!connected || callActive || !!groupInfo?.isGroup}
            aria-label="Start voice call"
            title="Voice call"
          >
            <Phone size={16} />
          </button>

          <button
            type="button"
            className="icon-action-btn"
            onClick={() => startCall('video')}
            disabled={!connected || callActive || !!groupInfo?.isGroup}
            aria-label="Start video call"
            title="Video call"
          >
            <Video size={16} />
          </button>

          <button
            type="button"
            className="icon-danger-btn"
            onClick={killSwitch}
            title="Wipe room and leave"
            aria-label="Wipe room and leave"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      <div className="room-body">
        <main className="thread-panel">
          <div className="thread-banner">
            <div className="thread-banner-copy">
              <strong>End-to-end encrypted</strong>
              <span>
                {groupInfo?.isGroup
                  ? `${participants.length}/${groupInfo.maxParticipants} participants · History stored locally`
                  : '2 participants max · History stored locally'}
              </span>
            </div>
          </div>

          <ChatView
            messages={messages}
            connected={connected || !!groupInfo?.isGroup}
            peerTyping={peerTyping}
            draft={draft}
            onDraftChange={handleDraftChange}
            onSend={sendMessage}
          />
        </main>
      </div>

      <button type="button" className="leave-link" onClick={() => void leaveRoomOnly()}>
        Leave room
      </button>

      {!groupInfo?.isGroup && callActive && callType === 'voice' && (
        <VoiceCallView
          peerName="Peer"
          phase={callPhase}
          quality={callQuality}
          micOn={micOn}
          speakerOn={speakerOn}
          headphonesOn={headphonesOn}
          onHold={onHold}
          remoteStream={remoteStream}
          onAccept={acceptCall}
          onReject={rejectCall}
          onEnd={endCall}
          onToggleMic={toggleMic}
          onToggleSpeaker={() => setSpeakerOn((v) => !v)}
          onToggleHeadphones={() => setHeadphonesOn((v) => !v)}
          onToggleHold={toggleHold}
        />
      )}

      {!groupInfo?.isGroup && callActive && callType === 'video' && (
        <VideoCallView
          peerName="Peer"
          phase={callPhase}
          quality={callQuality}
          micOn={micOn}
          camOn={camOn}
          blurOn={blurOn}
          localStream={localStream}
          remoteStream={remoteStream}
          onAccept={acceptCall}
          onReject={rejectCall}
          onEnd={endCall}
          onToggleMic={toggleMic}
          onToggleCam={toggleCam}
          onToggleBlur={() => setBlurOn((v) => !v)}
          onSwitchCamera={() => rtcApi.switchCamera()}
        />
      )}
    </div>
  );
}