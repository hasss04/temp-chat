import { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  PhoneOff,
  Phone,
  Video,
  VideoOff,
  SwitchCamera,
  Sparkles,
  SignalHigh,
  SignalMedium,
  SignalLow,
} from 'lucide-react';
import type { CallPhase, CallQuality } from '../types';

function initialsOf(name: string) {
  return (name || 'A').trim().slice(0, 2).toUpperCase();
}

function formatElapsed(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  if (hh > 0) return `${hh}:${mm.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`;
  return `${mm}:${r.toString().padStart(2, '0')}`;
}

function QualityIcon({ quality }: { quality: CallQuality }) {
  if (quality === 'good') return <SignalHigh size={14} className="quality-good" />;
  if (quality === 'fair') return <SignalMedium size={14} className="quality-fair" />;
  if (quality === 'poor') return <SignalLow size={14} className="quality-poor" />;
  return <SignalHigh size={14} className="quality-unknown" />;
}

type Props = {
  peerName: string;
  phase: CallPhase;
  quality: CallQuality;
  micOn: boolean;
  camOn: boolean;
  blurOn: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleBlur: () => void;
  onSwitchCamera: () => void;
};

export function VideoCallView({
  peerName,
  phase,
  quality,
  micOn,
  camOn,
  blurOn,
  localStream,
  remoteStream,
  onAccept,
  onReject,
  onEnd,
  onToggleMic,
  onToggleCam,
  onToggleBlur,
  onSwitchCamera,
}: Props) {
  const remoteRef = useRef<HTMLVideoElement>(null);
  const localRef = useRef<HTMLVideoElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (phase !== 'active') {
      startedAtRef.current = null;
      setElapsed(0);
      return;
    }
    startedAtRef.current = Date.now();
    const tick = setInterval(() => {
      if (startedAtRef.current) {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 500);
    return () => clearInterval(tick);
  }, [phase]);

  const hasRemoteVideo = !!remoteStream && remoteStream.getVideoTracks().some((t) => t.enabled);

  const statusLabel =
    phase === 'incoming'
      ? 'Incoming video call'
      : phase === 'outgoing'
        ? 'Calling\u2026'
        : phase === 'connecting'
          ? 'Connecting\u2026'
          : phase === 'active'
            ? formatElapsed(elapsed)
            : phase === 'ended'
              ? 'Call ended'
              : '';

  return (
    <div
      className={`call-overlay video-call phase-${phase}`}
      role="dialog"
      aria-label="Video call"
      aria-modal="true"
    >
      <div className="video-call-stage">
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          className={`video-call-remote ${hasRemoteVideo ? '' : 'hidden'}`}
        />
        {!hasRemoteVideo && (
          <div className="video-call-remote-fallback">
            <div className="avatar">{initialsOf(peerName)}</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{peerName}</div>
          </div>
        )}

        <div className="video-call-topbar">
          <div className="name">{peerName}</div>
          <div className="meta">
            {phase === 'active' && (
              <>
                <QualityIcon quality={quality} />
                <span>{statusLabel}</span>
              </>
            )}
            {phase !== 'active' && <span>{statusLabel}</span>}
          </div>
        </div>

        {phase === 'active' && (
          <div className={`video-call-local ${camOn ? '' : 'cam-off'}`}>
            {camOn ? (
              <video ref={localRef} autoPlay playsInline muted />
            ) : (
              <VideoOff size={24} />
            )}
          </div>
        )}
      </div>

      {phase === 'incoming' ? (
        <div className="video-call-controls">
          <button
            type="button"
            className="call-btn decline"
            onClick={onReject}
            aria-label="Decline call"
          >
            <PhoneOff size={26} />
          </button>
          <button
            type="button"
            className="call-btn accept"
            onClick={onAccept}
            aria-label="Accept call"
          >
            <Phone size={26} />
          </button>
        </div>
      ) : (
        <div className="video-call-controls">
          <button
            type="button"
            className={`call-btn ${micOn ? '' : 'active'}`}
            onClick={onToggleMic}
            aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
            aria-pressed={!micOn}
          >
            {micOn ? <Mic size={20} /> : <MicOff size={20} />}
          </button>
          <button
            type="button"
            className={`call-btn ${camOn ? '' : 'active'}`}
            onClick={onToggleCam}
            aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
            aria-pressed={!camOn}
          >
            {camOn ? <Video size={20} /> : <VideoOff size={20} />}
          </button>
          <button
            type="button"
            className={`call-btn ${blurOn ? 'active' : ''}`}
            onClick={onToggleBlur}
            aria-label="Toggle background blur"
            aria-pressed={blurOn}
          >
            <Sparkles size={20} />
          </button>
          <button
            type="button"
            className="call-btn"
            onClick={onSwitchCamera}
            aria-label="Switch camera"
          >
            <SwitchCamera size={20} />
          </button>
          <button
            type="button"
            className="call-btn end"
            onClick={onEnd}
            aria-label="End call"
          >
            <PhoneOff size={26} />
          </button>
        </div>
      )}
    </div>
  );
}
