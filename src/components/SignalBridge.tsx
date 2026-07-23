import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Phone, Video, WifiOff, Users, LogOut } from 'lucide-react';
import {
  SignalError,
  deriveRole,
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

type DerivedRole = 'waiting' | 'offerer' | 'answerer';
type ActiveRole = 'offerer' | 'answerer';

const FAST_POLL_MS = 1500;

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
  const peerId = useAppStore((s) => s.peerId);

  // The presence server already tracks each participant's nickname
  // (room.participants[].nickname) — we just weren't reading it before.
  const peerParticipant = participants.find((p) => p.peerId !== peerId);
  const peerDisplayName = peerParticipant?.nickname?.trim() || 'Anon';

  const [role, setRole] = useState<ActiveRole | null>(null);
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

  const connectedRef = useRef(connected);
  connectedRef.current = connected;

  const appliedIce = useRef<Record<string, number>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const answerAppliedRef = useRef(false);
  const answeredOfferSdpRef = useRef<string | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localTypingSentRef = useRef(false);
  const draftPersistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCallInitiatorRef = useRef(false);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const groupPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const groupInfoRef = useRef(groupInfo);
  groupInfoRef.current = groupInfo;

  const connectionStatusRef = useRef(connectionStatus);
  connectionStatusRef.current = connectionStatus;

  const triggerReconnect = useCallback(() => {
    if (!roomId || !secret || !peerId) return;
    if (connectionStatusRef.current === 'reconnecting' || connectionStatusRef.current === 'joining') return;
    setStatePartial({ connectionStatus: 'reconnecting', connected: false });
    pushToast({
      tone: 'info',
      title: 'Reconnecting',
      message: 'Trying to restore the connection.',
    });
    answerAppliedRef.current = false;
    answeredOfferSdpRef.current = null;
    appliedIce.current = {};
    pendingIceRef.current = [];
    setRestartKey((k) => k + 1);
  }, [roomId, secret, peerId, setStatePartial, pushToast]);

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
        if (groupInfoRef.current?.isGroup) {
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
      // Previously, a dropped ICE connection while the tab stayed open and
      // visible (e.g. a transient mobile network blip switching towers or
      // Wi-Fi<->cellular) had no recovery path — only visibility/online
      // events triggered a reconnect. This closes that gap.
      onConnectionTrouble: () => {
        if (groupInfoRef.current?.isGroup) return;
        triggerReconnect();
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

  useVisibilityReconnect(() => rtcApiRef.current.getConnectionState(), triggerReconnect);

  useEffect(() => {
    if (!roomId || !secret) return;
    persistMessages(roomId, secret, messages).catch(() => {});
  }, [messages, roomId, secret]);

  // Heartbeat: without this, the room's updatedAt/lastSeenAt freeze the
  // moment the WebRTC connection succeeds (see syncOnce/pollRef below,
  // which both stop talking to the presence server once connected). That
  // caused rooms to expire ~30 min after *joining* regardless of ongoing
  // activity, and participants to be pruned as "stale" after 2 minutes of
  // silence even mid-conversation. This keeps presence alive for genuinely
  // active sessions; it stops (and the room can expire) once the tab is
  // actually closed or the room is left.
  useEffect(() => {
    if (!roomId || !secret || !peerId) return;
    const heartbeat = setInterval(() => {
      joinRoom(roomId, peerId, nickname, secret).catch(() => {});
    }, 60_000);
    return () => clearInterval(heartbeat);
  }, [roomId, peerId, nickname, secret]);

  useEffect(() => {
    if (!roomId || !secret) return;
    persistSession({
      roomId,
      peerId,
      nickname,
      secret,
      activeTab,
      theme: themeMode,
      draft,
      lastSeenAt: Date.now(),
    }).catch(() => {});
  }, [roomId, peerId, nickname, secret, activeTab, themeMode, draft]);

  useEffect(() => {
    if (!roomId || !secret) return;
    if (draftPersistTimeoutRef.current) clearTimeout(draftPersistTimeoutRef.current);
    draftPersistTimeoutRef.current = setTimeout(() => {
      persistSession({
        roomId,
        peerId,
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
  }, [draft, roomId, secret, peerId, nickname, activeTab, themeMode]);

  useEffect(() => {
    if (!roomId || !secret || !peerId) return;

    let myRole: DerivedRole = 'waiting';
    let cancelled = false;

    pendingIceRef.current = [];
    answerAppliedRef.current = false;
    answeredOfferSdpRef.current = null;
    appliedIce.current = {};
    setRole(null);
    setLocalStream(null);
    setRemoteStream(null);

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

    const offIce = rtcApiRef.current.onIceCandidate((candidate) => {
      const init = candidate.toJSON();
      postIce(roomId, peerId, init).catch(() => {
        pendingIceRef.current.push(init);
      });
    });

    async function flushPendingIce() {
      if (!pendingIceRef.current.length) return;
      const queued = [...pendingIceRef.current];
      pendingIceRef.current = [];
      for (const init of queued) {
        try {
          await postIce(roomId, peerId, init);
        } catch {
          pendingIceRef.current.push(init);
        }
      }
    }

    function reportTransientError(error: unknown) {
      if (cancelled) return;
      console.error('[signal-sync] failed', error);
      pushToast({
        tone: 'error',
        title: 'Sync issue',
        message:
          error instanceof Error
            ? error.message
            : 'Could not reach the signaling server. Retrying…',
      });
    }

    async function maybeAnswerRoomOffer(room: Awaited<ReturnType<typeof getRoom>>) {
      if (myRole !== 'answerer' || !room.offer) return;

      const parsedOffer = JSON.parse(room.offer) as RTCSessionDescriptionInit;
      const offerSdp = parsedOffer.sdp ?? null;

      if (offerSdp && answeredOfferSdpRef.current === offerSdp) {
        answerAppliedRef.current = true;
        return;
      }

      const answer = await rtcApiRef.current.acceptRemoteOffer(parsedOffer);
      await postAnswer(roomId, peerId, answer);

      answeredOfferSdpRef.current = offerSdp;
      answerAppliedRef.current = true;
    }

    async function syncOnce() {
      if (groupInfoRef.current?.isGroup || cancelled) return;
      if (rtcApiRef.current.getConnectionState() === 'connected') return;

      try {
        const room = await getRoom(roomId);

        // TEMPORARY DEBUG LOG — remove after diagnosing connection issue
        console.log('[debug] room', roomId, JSON.stringify(room));

        await flushPendingIce();

        const updatedParticipants =
          room.participants?.map((p) => ({
            peerId: p.peerId,
            nickname: p.nickname || 'Anon',
            status: 'online' as const,
            joinedAt: p.joinedAt,
          })) ?? [];
        setParticipants(updatedParticipants);

        if (myRole === 'answerer' && room.offer) {
          await maybeAnswerRoomOffer(room);
        }

        if (myRole === 'offerer' && room.answer && !connectedRef.current) {
          await rtcApiRef.current.acceptRemoteAnswer(JSON.parse(room.answer));
        }

        for (const [otherId, candidates] of Object.entries(room.ice ?? {})) {
          if (otherId === peerId) continue;
          const applied = appliedIce.current[otherId] ?? 0;
          for (let i = applied; i < candidates.length; i++) {
            await rtcApiRef.current.addIceCandidate(JSON.parse(candidates[i]));
          }
          appliedIce.current[otherId] = candidates.length;
        }
      } catch (error) {
        if (error instanceof SignalError && error.code === 'ROOM_FULL') {
          if (!cancelled) {
            setStatePartial({ connectionStatus: 'error', roomFull: true, connected: false });
          }
          return;
        }
        if (error instanceof SignalError && error.code === 'WRONG_PASSWORD') {
          if (!cancelled) {
            setStatePartial({ connectionStatus: 'error', connected: false });
            pushToast({
              tone: 'error',
              title: 'Wrong password',
              message: 'The password for this room is incorrect.',
            });
          }
          return;
        }
        if (!cancelled && rtcApiRef.current.getConnectionState() !== 'connected') {
          setStatePartial({ connectionStatus: 'error', connected: false });
          reportTransientError(error);
        }
      }
    }

    void (async () => {
      try {
        setStatePartial({
          connectionStatus: restartKey > 0 ? 'reconnecting' : 'joining',
          roomFull: false,
          connected: false,
          peerId,
        });

        const joinedRoom = await getRoom(roomId);

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
            maxParticipants: joinedRoom.maxPeers ?? 10,
          });
          setStatePartial({ connectionStatus: 'connected', connected: true });

          async function pollGroup() {
            if (cancelled) return;
            try {
              const room = await getRoom(roomId);
              const updated =
                room.participants?.map((p) => ({
                  peerId: p.peerId,
                  nickname: p.nickname || 'Anon',
                  status: 'online' as const,
                  joinedAt: p.joinedAt,
                })) ?? [];
              setParticipants(updated);
              setGroupInfo({
                roomId,
                isGroup: true,
                participants: updated,
                maxParticipants: room.maxPeers ?? 10,
              });
            } catch (error) {
              reportTransientError(error);
            }
          }

          groupPollRef.current = setInterval(() => void pollGroup(), FAST_POLL_MS * 2);
          return;
        }

        setGroupInfo(null);
        const roleStartedRef = { current: false };
        myRole = 'waiting';

        async function tryResolveRoleAndStart(seedRoom?: typeof joinedRoom) {
          if (cancelled || roleStartedRef.current) return;
          try {
            const room = seedRoom ?? (await getRoom(roomId));
            const derived = deriveRole(room, peerId);

            if (derived === 'waiting') {
              setStatePartial({ connectionStatus: 'waiting', connected: false });
              return;
            }

            roleStartedRef.current = true;
            myRole = derived;
            setRole(derived);

            if (derived === 'offerer') {
              setStatePartial({ connectionStatus: 'waiting', connected: false });
              const offer = await rtcApiRef.current.createLocalOffer();
              await postOffer(roomId, peerId, offer);
            } else {
              setStatePartial({ connectionStatus: 'connecting', connected: false });
              if (room.offer) {
                await maybeAnswerRoomOffer(room);
              }
            }
          } catch (error) {
            if (error instanceof SignalError && error.code === 'WRONG_PASSWORD') {
              if (!cancelled) {
                setStatePartial({ connectionStatus: 'error', connected: false });
                pushToast({
                  tone: 'error',
                  title: 'Wrong password',
                  message: 'The password for this room is incorrect.',
                });
              }
              return;
            }
            if (!cancelled && rtcApiRef.current.getConnectionState() !== 'connected') {
              setStatePartial({ connectionStatus: 'error', connected: false });
              reportTransientError(error);
            }
          }
        }

        await tryResolveRoleAndStart(joinedRoom);
        void syncOnce();

        pollRef.current = setInterval(() => {
          if (rtcApiRef.current.getConnectionState() === 'connected') {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            return;
          }
          void tryResolveRoleAndStart();
          void syncOnce();
        }, FAST_POLL_MS);
      } catch (error) {
        if (cancelled) return;
        setStatePartial({ connectionStatus: 'error', connected: false });
        pushToast({
          tone: 'error',
          title: 'Connection failed',
          message: error instanceof Error ? error.message : 'Could not open the room.',
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
      if (groupPollRef.current) {
        clearInterval(groupPollRef.current);
        groupPollRef.current = null;
      }
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (peerTypingTimeoutRef.current) clearTimeout(peerTypingTimeoutRef.current);

      window.removeEventListener('tempchat:local-stream', onLocal as EventListener);
      window.removeEventListener('tempchat:remote-stream', onRemote as EventListener);
    };
  }, [
    peerId,
    pushToast,
    roomId,
    restartKey,
    setStatePartial,
    setGroupInfo,
    setParticipants,
    secret,
  ]);

  useEffect(() => {
    if (connected) {
      setStatePartial({ connectionStatus: 'connected' });
    }
  }, [connected, setStatePartial]);

  useEffect(() => {
    function markVisibleMessagesSeen() {
      if (!connected || activeTab !== 'chat' || document.visibilityState !== 'visible') return;
      messages
        .filter((msg) => msg.sender === 'peer' && !msg.seenAt)
        .forEach((msg) => {
          rtcApiRef.current.send({
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
  }, [messages, connected, activeTab]);

  useEffect(() => {
    if (callPhase !== 'active') return;
    const id = window.setInterval(async () => {
      setCallQuality(await rtcApiRef.current.getCallQuality());
    }, 3000);
    return () => window.clearInterval(id);
  }, [callPhase]);

  function stopTypingSignal() {
    if (!localTypingSentRef.current) return;
    localTypingSentRef.current = false;
    rtcApiRef.current.send({ kind: 'typing', isTyping: false });
  }

  function handleDraftChange(value: string) {
    setDraft(value);
    if (groupInfo?.isGroup) return;
    if (!connected || !rtcApiRef.current.isDataChannelOpen()) return;

    if (value.trim() && !localTypingSentRef.current) {
      localTypingSentRef.current = true;
      rtcApiRef.current.send({ kind: 'typing', isTyping: true });
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
      rtcApiRef.current.send({
        kind: 'chat',
        id,
        text,
        senderName: nickname || 'Anon',
        createdAt,
      });
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
    rtcApiRef.current.send({ kind: 'call-invite', callType: type });
  }

  async function acceptCall() {
    if (!callType) return;
    setCallPhase('connecting');
    try {
      await rtcApiRef.current.acquireCallMedia(callType);
      rtcApiRef.current.send({ kind: 'call-accept', callType });
      setCallPhase('active');
    } catch {
      pushToast({
        tone: 'error',
        title: 'Permission denied',
        message: 'Allow microphone and camera access to accept the call.',
      });
      rtcApiRef.current.send({ kind: 'call-reject' });
      resetCallState();
    }
  }

  function rejectCall() {
    rtcApiRef.current.send({ kind: 'call-reject' });
    resetCallState();
  }

  function endCall() {
    rtcApiRef.current.send({ kind: 'call-end' });
    resetCallState();
  }

  function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    rtcApiRef.current.toggleAudio(next);
  }

  function toggleCam() {
    const next = !camOn;
    setCamOn(next);
    rtcApiRef.current.toggleVideo(next);
  }

  function toggleHold() {
    const next = !onHold;
    setOnHold(next);
    rtcApiRef.current.toggleAudio(!next && micOn);
    rtcApiRef.current.send({ kind: 'call-hold', onHold: next });
  }

  async function killSwitch() {
    rtcApiRef.current.destroy();
    await wipeRoom(roomId).catch(() => {});
    await clearPersistedSession(roomId).catch(() => {});
    if (peerId) {
      await leaveRoom(roomId, peerId).catch(() => {});
    }
    reset();
    pushToast({
      tone: 'success',
      title: 'Room cleared',
      message: 'Chat history and session removed from this device.',
    });
  }

  async function leaveRoomOnly() {
    rtcApiRef.current.destroy();
    await clearPersistedSession(roomId).catch(() => {});
    if (peerId) {
      await leaveRoom(roomId, peerId).catch(() => {});
    }
    setStatePartial({
      roomId: '',
      peerId: '',
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
            {groupInfo?.isGroup ? <Users size={16} /> : initialsOf(peerDisplayName)}
          </div>
          <div className="room-meta">
            <div className="room-meta-top">
              <p className="room-peer-name">{groupInfo?.isGroup ? 'Group room' : peerDisplayName}</p>
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
            className="icon-action-btn"
            onClick={() => void leaveRoomOnly()}
            title="Leave room"
            aria-label="Leave room"
          >
            <LogOut size={16} />
          </button>
          <button
            type="button"
            className="icon-danger-btn"
            onClick={() => void killSwitch()}
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
            peerName={groupInfo?.isGroup ? undefined : peerDisplayName}
          />
        </main>
      </div>

      {!groupInfo?.isGroup && callActive && callType === 'voice' && (
        <VoiceCallView
          peerName={peerDisplayName}
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
          peerName={peerDisplayName}
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
          onSwitchCamera={() => rtcApiRef.current.switchCamera()}
        />
      )}
    </div>
  );
}