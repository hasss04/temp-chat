import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { CallQuality, CallType, WireMessage } from '../types';

const CHANNEL_NAME = 'tempchat-v2';

/**
 * STUN alone only works when both peers are behind simple/full-cone NATs.
 * Any peer behind a symmetric NAT, CGNAT (very common on mobile carriers),
 * or a restrictive corporate/public Wi-Fi firewall will fail to connect
 * without a TURN relay as fallback. Set these env vars (Vite: must be
 * prefixed VITE_) to point at your TURN provider (Twilio NTS, Metered.ca,
 * or a self-hosted coturn instance). If they're not set, we fall back to
 * STUN-only, which is why connections were unreliable before.
 */
function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ];

  const turnUrls = import.meta.env.VITE_TURN_URLS as string | undefined;
  const turnUsername = import.meta.env.VITE_TURN_USERNAME as string | undefined;
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;

  if (turnUrls) {
    servers.push({
      urls: turnUrls.split(',').map((u) => u.trim()).filter(Boolean),
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
}

type Handlers = {
  onChat: (msg: Extract<WireMessage, { kind: 'chat' }>) => void;
  onTyping: (isTyping: boolean) => void;
  onReceipt: (msg: Extract<WireMessage, { kind: 'receipt' }>) => void;
  onCallSignal: (
    msg: Extract<
      WireMessage,
      { kind: 'call-invite' | 'call-accept' | 'call-reject' | 'call-end' | 'call-hold' }
    >,
  ) => void;
  /**
   * Called whenever the underlying ICE connection drops to
   * 'failed' | 'disconnected' | 'closed'. Previously the only reconnect
   * path was tied to document visibility changes, so a transient network
   * blip (very common on mobile switching towers/Wi-Fi) while the tab
   * stayed open/visible had no recovery path at all.
   */
  onConnectionTrouble?: (state: RTCIceConnectionState) => void;
};

export function useWebRTC(handlers: Handlers, restartKey = 0) {
  const setStatePartial = useAppStore((s) => s.setStatePartial);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataRef = useRef<RTCDataChannel | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const remoteRef = useRef<MediaStream | null>(null);
  const iceExternalRef = useRef<((candidate: RTCIceCandidate) => void) | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const pc = new RTCPeerConnection({
      iceServers: buildIceServers(),
      iceCandidatePoolSize: 4,
      iceTransportPolicy: 'all',
    });

    const remoteStream = new MediaStream();
    const remoteTrackIds = new Set<string>();

    peerRef.current = pc;
    dataRef.current = null;
    localRef.current = null;
    remoteRef.current = remoteStream;
    pendingIceRef.current = [];
    setStatePartial({ connected: false });

    pc.ondatachannel = (event) => {
      dataRef.current = event.channel;
      bindChannel(event.channel);
    };

    pc.ontrack = (event) => {
      const stream = remoteRef.current;
      if (!stream) return;

      for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
        if (remoteTrackIds.has(track.id)) continue;
        remoteTrackIds.add(track.id);
        stream.addTrack(track);
      }

      window.dispatchEvent(new CustomEvent('tempchat:remote-stream', { detail: stream }));
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;

      const channel = dataRef.current;
      if (channel && channel.readyState === 'open') {
        try {
          channel.send(
            JSON.stringify({
              kind: 'rtc-ice',
              candidate: JSON.stringify(event.candidate.toJSON()),
            } satisfies WireMessage),
          );
        } catch {}
      }

      iceExternalRef.current?.(event.candidate);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      setStatePartial({ connected: state === 'connected' });

      if (state === 'closed' || state === 'failed') {
        window.dispatchEvent(new CustomEvent('tempchat:remote-stream', { detail: null }));
      }
    };

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;

      if (iceState === 'connected' || iceState === 'completed') {
        setStatePartial({ connected: true });
      }

      if (iceState === 'failed' || iceState === 'closed' || iceState === 'disconnected') {
        setStatePartial({ connected: false });
        handlersRef.current.onConnectionTrouble?.(iceState);
      }
    };

    return () => {
      pc.ondatachannel = null;
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;

      dataRef.current?.close();
      dataRef.current = null;

      localRef.current?.getTracks().forEach((track) => track.stop());
      remoteRef.current?.getTracks().forEach((track) => track.stop());

      pc.getSenders().forEach((sender) => {
        try {
          sender.track?.stop();
        } catch {}
      });

      pc.close();
      peerRef.current = null;
      localRef.current = null;
      remoteRef.current = null;
      pendingIceRef.current = [];
      setStatePartial({ connected: false });

      window.dispatchEvent(new CustomEvent('tempchat:local-stream', { detail: null }));
      window.dispatchEvent(new CustomEvent('tempchat:remote-stream', { detail: null }));
    };
  }, [setStatePartial, restartKey]);

  function bindChannel(channel: RTCDataChannel) {
    channel.onopen = () => {
      setStatePartial({ connected: true });
    };

    channel.onclose = () => {
      setStatePartial({ connected: false });
    };

    channel.onerror = () => {
      setStatePartial({ connected: false });
    };

    channel.onmessage = (event) => {
      if (typeof event.data !== 'string') return;

      try {
        const wire = JSON.parse(event.data) as WireMessage;

        switch (wire.kind) {
          case 'chat':
            handlersRef.current.onChat(wire);
            break;
          case 'typing':
            handlersRef.current.onTyping(wire.isTyping);
            break;
          case 'receipt':
            handlersRef.current.onReceipt(wire);
            break;
          case 'call-invite':
          case 'call-accept':
          case 'call-reject':
          case 'call-end':
          case 'call-hold':
            handlersRef.current.onCallSignal(wire);
            break;
          case 'rtc-offer':
            void handleRemoteRenegotiationOffer(wire.sdp);
            break;
          case 'rtc-answer':
            void handleRemoteRenegotiationAnswer(wire.sdp);
            break;
          case 'rtc-ice':
            void addIceCandidate(JSON.parse(wire.candidate));
            break;
        }
      } catch {}
    };
  }

  async function flushPendingIce() {
    const pc = peerRef.current;
    if (!pc || !pc.remoteDescription) return;

    const queued = pendingIceRef.current;
    if (!queued.length) return;

    pendingIceRef.current = [];

    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Failed to flush queued ICE candidate', error);
      }
    }
  }

  async function createLocalOffer() {
    const pc = peerRef.current;
    if (!pc) throw new Error('Peer connection unavailable');

    const existingChannel = dataRef.current;
    if (!existingChannel || existingChannel.readyState === 'closed') {
      const channel = pc.createDataChannel(CHANNEL_NAME, { ordered: true });
      dataRef.current = channel;
      bindChannel(channel);
    }

    if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-local-offer') {
      throw new Error(`Cannot create local offer while signalingState=${pc.signalingState}`);
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return pc.localDescription ?? offer;
  }

  async function acceptRemoteOffer(offer: RTCSessionDescriptionInit) {
    const pc = peerRef.current;
    if (!pc) throw new Error('Peer connection unavailable');

    const alreadySet =
      pc.remoteDescription &&
      pc.remoteDescription.type === offer.type &&
      pc.remoteDescription.sdp === offer.sdp;

    if (!alreadySet) {
      if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-remote-offer') {
        throw new Error(`Cannot apply remote offer while signalingState=${pc.signalingState}`);
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await flushPendingIce();
    }

    if (
      pc.signalingState !== 'have-remote-offer' &&
      pc.signalingState !== 'have-local-pranswer'
    ) {
      if (pc.localDescription?.type === 'answer') {
        return pc.localDescription;
      }
      throw new Error(`Cannot create answer while signalingState=${pc.signalingState}`);
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return pc.localDescription ?? answer;
  }

  async function acceptRemoteAnswer(answer: RTCSessionDescriptionInit) {
    const pc = peerRef.current;
    if (!pc) throw new Error('Peer connection unavailable');
    if (pc.signalingState === 'stable') return;

    const alreadySet =
      pc.remoteDescription &&
      pc.remoteDescription.type === answer.type &&
      pc.remoteDescription.sdp === answer.sdp;

    if (alreadySet) return;
    if (pc.signalingState !== 'have-local-offer') return;

    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    await flushPendingIce();
  }

  async function addIceCandidate(candidate: RTCIceCandidateInit) {
    const pc = peerRef.current;
    if (!pc) return;

    if (!pc.remoteDescription) {
      pendingIceRef.current.push(candidate);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('Failed to add ICE candidate', error);
    }
  }

  async function acquireCallMedia(type: CallType) {
    if (localRef.current) return localRef.current;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video:
        type === 'video'
          ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
          : false,
    });

    localRef.current = stream;

    const pc = peerRef.current;
    if (pc) {
      const senderKinds = new Set(
        pc.getSenders().map((sender) => sender.track?.kind).filter(Boolean),
      );

      stream.getTracks().forEach((track) => {
        if (!senderKinds.has(track.kind)) {
          pc.addTrack(track, stream);
        }
      });
    }

    window.dispatchEvent(new CustomEvent('tempchat:local-stream', { detail: stream }));
    return stream;
  }

  async function renegotiate() {
    const pc = peerRef.current;
    const channel = dataRef.current;
    if (!pc || !channel || channel.readyState !== 'open') return;
    if (pc.signalingState !== 'stable') return;

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    channel.send(
      JSON.stringify({
        kind: 'rtc-offer',
        sdp: JSON.stringify(pc.localDescription ?? offer),
      } satisfies WireMessage),
    );
  }

  async function handleRemoteRenegotiationOffer(sdpJson: string) {
    const pc = peerRef.current;
    const channel = dataRef.current;
    if (!pc || !channel) return;

    const offer = JSON.parse(sdpJson) as RTCSessionDescriptionInit;
    const alreadySet =
      pc.remoteDescription &&
      pc.remoteDescription.type === offer.type &&
      pc.remoteDescription.sdp === offer.sdp;

    if (!alreadySet) {
      if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-remote-offer') {
        return;
      }
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await flushPendingIce();
    }

    if (
      pc.signalingState !== 'have-remote-offer' &&
      pc.signalingState !== 'have-local-pranswer'
    ) {
      return;
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    if (channel.readyState === 'open') {
      channel.send(
        JSON.stringify({
          kind: 'rtc-answer',
          sdp: JSON.stringify(pc.localDescription ?? answer),
        } satisfies WireMessage),
      );
    }
  }

  async function handleRemoteRenegotiationAnswer(sdpJson: string) {
    const pc = peerRef.current;
    if (!pc || pc.signalingState === 'stable') return;
    if (pc.signalingState !== 'have-local-offer') return;

    const answer = JSON.parse(sdpJson) as RTCSessionDescriptionInit;
    const alreadySet =
      pc.remoteDescription &&
      pc.remoteDescription.type === answer.type &&
      pc.remoteDescription.sdp === answer.sdp;

    if (alreadySet) return;

    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    await flushPendingIce();
  }

  function endCall() {
    localRef.current?.getTracks().forEach((track) => track.stop());
    localRef.current = null;

    const pc = peerRef.current;
    if (pc) {
      pc.getSenders().forEach((sender) => {
        if (sender.track) {
          try {
            pc.removeTrack(sender);
          } catch {}
        }
      });
    }

    window.dispatchEvent(new CustomEvent('tempchat:local-stream', { detail: null }));
  }

  function toggleAudio(enabled: boolean) {
    localRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  function toggleVideo(enabled: boolean) {
    localRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  async function switchCamera() {
    const pc = peerRef.current;
    const stream = localRef.current;
    if (!pc || !stream) return;

    const currentTrack = stream.getVideoTracks()[0];
    if (!currentTrack) return;

    const currentFacing = currentTrack.getSettings().facingMode;
    const nextFacing = currentFacing === 'environment' ? 'user' : 'environment';

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing },
        audio: false,
      });

      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) return;

      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      await sender?.replaceTrack(newTrack);

      currentTrack.stop();
      stream.removeTrack(currentTrack);
      stream.addTrack(newTrack);

      window.dispatchEvent(new CustomEvent('tempchat:local-stream', { detail: stream }));
    } catch (error) {
      console.error('Failed to switch camera', error);
    }
  }

  async function getCallQuality(): Promise<CallQuality> {
    const pc = peerRef.current;
    if (!pc) return 'unknown';

    try {
      const stats = await pc.getStats();
      let rttMs: number | null = null;

      stats.forEach((report) => {
        if (
          report.type === 'candidate-pair' &&
          (report as RTCIceCandidatePairStats).state === 'succeeded'
        ) {
          const rtt = (report as RTCIceCandidatePairStats).currentRoundTripTime;
          if (typeof rtt === 'number') rttMs = rtt * 1000;
        }
      });

      if (rttMs === null) return 'unknown';
      if (rttMs < 150) return 'good';
      if (rttMs < 350) return 'fair';
      return 'poor';
    } catch {
      return 'unknown';
    }
  }

  function send(wire: WireMessage): boolean {
    const channel = dataRef.current;
    if (!channel || channel.readyState !== 'open') return false;

    try {
      channel.send(JSON.stringify(wire));
      return true;
    } catch (error) {
      console.error('Failed to send over data channel', error);
      return false;
    }
  }

  function onIceCandidate(callback: (candidate: RTCIceCandidate) => void) {
    iceExternalRef.current = callback;
    return () => {
      if (iceExternalRef.current === callback) {
        iceExternalRef.current = null;
      }
    };
  }

  function getConnectionState(): RTCPeerConnectionState | 'unknown' {
    return peerRef.current?.connectionState ?? 'unknown';
  }

  function getIceConnectionState(): RTCIceConnectionState | 'unknown' {
    return peerRef.current?.iceConnectionState ?? 'unknown';
  }

  function isDataChannelOpen(): boolean {
    return dataRef.current?.readyState === 'open';
  }

  function destroy() {
    dataRef.current?.close();
    dataRef.current = null;

    localRef.current?.getTracks().forEach((track) => track.stop());
    remoteRef.current?.getTracks().forEach((track) => track.stop());

    peerRef.current?.close();
    peerRef.current = null;
    localRef.current = null;
    remoteRef.current = null;
    pendingIceRef.current = [];

    setStatePartial({ connected: false });
    window.dispatchEvent(new CustomEvent('tempchat:local-stream', { detail: null }));
    window.dispatchEvent(new CustomEvent('tempchat:remote-stream', { detail: null }));
  }

  return {
    createLocalOffer,
    acceptRemoteOffer,
    acceptRemoteAnswer,
    addIceCandidate,
    acquireCallMedia,
    renegotiate,
    endCall,
    toggleAudio,
    toggleVideo,
    switchCamera,
    getCallQuality,
    send,
    onIceCandidate,
    destroy,
    getConnectionState,
    getIceConnectionState,
    isDataChannelOpen,
  };
}