import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';

const channelName = 'tempchat-channel';

export function useWebRTC(onMessage: (text: string) => void, restartKey = 0) {
  const setStatePartial = useAppStore((s) => s.setStatePartial);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataRef = useRef<RTCDataChannel | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const remoteRef = useRef<MediaStream | null>(null);

  // Keep the latest onMessage callback without retriggering the effect
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

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
      window.dispatchEvent(
        new CustomEvent('tempchat:remote-stream', {
          detail: remoteStream,
        }),
      );
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      setStatePartial({
        connected: state === 'connected',
      });
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
  }, [setStatePartial, restartKey]); // <-- removed onMessage from deps

  function bindChannel(channel: RTCDataChannel) {
    channel.onopen = () => setStatePartial({ connected: true });
    channel.onclose = () => setStatePartial({ connected: false });
    channel.onerror = () => setStatePartial({ connected: false });
    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        onMessageRef.current(event.data);
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
    if (localRef.current) {
      return localRef.current;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    localRef.current = stream;
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });
    window.dispatchEvent(
      new CustomEvent('tempchat:local-stream', {
        detail: stream,
      }),
    );
    return stream;
  }

  function sendText(text: string) {
    if (dataRef.current?.readyState === 'open') {
      dataRef.current.send(text);
    }
  }

  function onIceCandidate(callback: (candidate: RTCIceCandidate) => void) {
    const pc = peerRef.current;
    if (!pc) return () => {};
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        callback(event.candidate);
      }
    };
    return () => {
      if (peerRef.current === pc) {
        pc.onicecandidate = null;
      }
    };
  }

  function getConnectionState(): RTCPeerConnectionState | 'unknown' {
    return peerRef.current?.connectionState ?? 'unknown';
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
    window.dispatchEvent(
      new CustomEvent('tempchat:local-stream', {
        detail: null,
      }),
    );
    window.dispatchEvent(
      new CustomEvent('tempchat:remote-stream', {
        detail: null,
      }),
    );
  }

  return {
    createLocalOffer,
    acceptRemoteOffer,
    acceptRemoteAnswer,
    addIceCandidate,
    startCall,
    sendText,
    onIceCandidate,
    destroy,
    getConnectionState,
  };
}