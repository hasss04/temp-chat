import { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Volume2,
  VolumeX,
  Headphones,
  Pause,
  Play,
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
  speakerOn: boolean;
  headphonesOn: boolean;
  onHold: boolean;
  remoteStream: MediaStream | null;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
  onToggleMic: () => void;
  onToggleSpeaker: () => void;
  onToggleHeadphones: () => void;
  onToggleHold: () => void;
};

export function VoiceCallView({
  peerName,
  phase,
  quality,
  micOn,
  speakerOn,
  headphonesOn,
  onHold,
  remoteStream,
  onAccept,
  onReject,
  onEnd,
  onToggleMic,
  onToggleSpeaker,
  onToggleHeadphones,
  onToggleHold,
}: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.srcObject = remoteStream;
  }, [remoteStream]);

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

  const statusLabel =
    phase === 'incoming'
      ? 'Incoming voice call'
      : phase === 'outgoing'
        ? 'Calling\u2026'
        : phase === 'connecting'
          ? 'Connecting\u2026'
          : phase === 'active'
            ? onHold
              ? 'On hold'
              : formatElapsed(elapsed)
            : phase === 'ended'
              ? 'Call ended'
              : '';

  return (
    <div
      className={`call-overlay voice-call phase-${phase}`}
      role="dialog"
      aria-label="Voice call"
      aria-modal="true"
    >
      <audio ref={audioRef} autoPlay playsInline />

      <div className="voice-call-header">
        <div className="voice-call-avatar">{initialsOf(peerName)}</div>
        <div className="voice-call-name">{peerName}</div>
        <div className="voice-call-status">
          <span>{statusLabel}</span>
          {phase === 'active' && (
            <span className="voice-call-quality">
              <QualityIcon quality={quality} />
              <span>{quality === 'good' ? 'Excellent' : quality === 'fair' ? 'Okay' : quality === 'poor' ? 'Weak' : ''}</span>
            </span>
          )}
        </div>
      </div>

      {phase === 'incoming' ? (
        <div className="call-controls">
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
        <div className="call-controls">
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
            className={`call-btn ${speakerOn ? 'active' : ''}`}
            onClick={onToggleSpeaker}
            aria-label={speakerOn ? 'Speaker on' : 'Speaker off'}
            aria-pressed={speakerOn}
          >
            {speakerOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </button>
          <button
            type="button"
            className={`call-btn ${headphonesOn ? 'active' : ''}`}
            onClick={onToggleHeadphones}
            aria-label="Toggle headphones"
            aria-pressed={headphonesOn}
          >
            <Headphones size={20} />
          </button>
          <button
            type="button"
            className={`call-btn ${onHold ? 'active' : ''}`}
            onClick={onToggleHold}
            aria-label={onHold ? 'Resume call' : 'Hold call'}
            aria-pressed={onHold}
          >
            {onHold ? <Play size={20} /> : <Pause size={20} />}
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
