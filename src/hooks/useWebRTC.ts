import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { WireMessage } from '../types';

const channelName = 'tempchat-channel';

type Handlers = {
  onChat: (msg: Extract<WireMessage, { kind: 'chat' }>) => void;
  onTyping: (isTyping: boolean) => void;
};

export function useWebRTC(handlers: Handlers, restartKey = 0) {
  const setStatePartial = useAppStore((s) => s.setStatePartial);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataRef = useRef<RTCDataChannel | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const remoteRef = useRef<MediaStream | null>(null);

  // Keep latest handlers without retriggering the connection effect
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
      ],
    });
    peerRef.current = pc;
    dataRef.current = null;
    localRef.current = null;
    remoteRef.current = new MediaStream();

    setStatePartial({ connected: false });

    pc.ondatachannel = (event) => {
      dataRef.current = event.channel;
      bindChannel(event.channel);
    };

    pc.ontrack = (event) => {
      const remoteStream = remoteRef.current;
      if (!remoteStream) return;
      event.streams[0]?.getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
      window.dispatchEvent(new CustomEvent('tempchat:remote-stream', { detail: remoteStream }));
    };

    pc.onconnectionstatechange = () => {
      setStatePartial({ connected: pc.connectionState === 'connected' });
    };

    return () => {
      pc.ondatachannel = null;
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
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
      setStatePartial({ connected: false });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setStatePartial, restartKey]);

  function bindChannel(channel: RTCDataChannel) {
    channel.onopen = () => setStatePartial({ connected: true });
    channel.onclose = () => setStatePartial({ connected: false });
    channel.onerror = () => setStatePartial({ connected: false });
    channel.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const wire = JSON.parse(event.data) as WireMessage;
        if (wire.kind === 'chat') {
          handlersRef.current.onChat(wire);
        } else if (wire.kind === 'typing') {
          handlersRef.current.onTyping(wire.isTyping);
        }
      } catch {
        // ignore malformed payloads
      }
    };
  }

  async function createLocalOffer() {
    const pc = peerRef.current;
    if (!pc) throw new Error('Peer connection unavailable');
    if (!dataRef.current || dataRef.current.readyState === 'closed') {
      const channel = pc.createDataChannel(channelName);
      dataRef.current = channel;
      bindChannel(channel);
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return pc.localDescription ?? offer;
  }

  async function acceptRemoteOffer(offer: RTCSessionDescriptionInit) {
    const pc = peerRef.current;
    if (!pc) throw new Error('Peer connection unavailable');
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return pc.localDescription ?? answer;
  }

  async function acceptRemoteAnswer(answer: RTCSessionDescriptionInit) {
    const pc = peerRef.current;
    if (!pc) throw new Error('Peer connection unavailable');
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async function addIceCandidate(candidate: RTCIceCandidateInit) {
    const pc = peerRef.current;
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('Failed to add ICE candidate', error);
    }
  }

  async function startCall() {
    const pc = peerRef.current;
    if (!pc) throw new Error('Peer connection unavailable');
    if (localRef.current) return localRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localRef.current = stream;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    window.dispatchEvent(new CustomEvent('tempchat:local-stream', { detail: stream }));
    return stream;
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
    localRef.current?.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }

  function toggleVideo(enabled: boolean) {
    localRef.current?.getVideoTracks().forEach((t) => (t.enabled = enabled));
  }

  function send(wire: WireMessage) {
    if (dataRef.current?.readyState === 'open') {
      dataRef.current.send(JSON.stringify(wire));
    }
  }

  function onIceCandidate(callback: (candidate: RTCIceCandidate) => void) {
    const pc = peerRef.current;
    if (!pc) return () => {};
    pc.onicecandidate = (event) => {
      if (event.candidate) callback(event.candidate);
    };
    return () => {
      if (peerRef.current === pc) pc.onicecandidate = null;
    };
  }

  function getConnectionState(): RTCPeerConnectionState | 'unknown' {
    return peerRef.current?.connectionState ?? 'unknown';
  }

  function hasLocalStream() {
    return !!localRef.current;
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
    setStatePartial({ connected: false });
    window.dispatchEvent(new CustomEvent('tempchat:local-stream', { detail: null }));
    window.dispatchEvent(new CustomEvent('tempchat:remote-stream', { detail: null }));
  }

  return {
    createLocalOffer,
    acceptRemoteOffer,
    acceptRemoteAnswer,
    addIceCandidate,
    startCall,
    endCall,
    toggleAudio,
    toggleVideo,
    send,
    onIceCandidate,
    destroy,
    getConnectionState,
    hasLocalStream,
  };
}