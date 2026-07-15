export type PlainMessage = {
  id: string;
  sender: 'me' | 'peer' | 'system';
  text: string;
  createdAt: number;
  deliveredAt?: number;
  seenAt?: number;
};

export type EncryptedBlob = {
  iv: string;
  cipherText: string;
};

export type CallType = 'voice' | 'video';
export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';
export type CallQuality = 'unknown' | 'good' | 'fair' | 'poor';

export type WireMessage =
  | { kind: 'chat'; id: string; text: string; senderName: string; createdAt: number }
  | { kind: 'typing'; isTyping: boolean }
  | { kind: 'receipt'; messageId: string; receipt: 'delivered' | 'seen'; at: number }
  | { kind: 'call-invite'; callType: CallType }
  | { kind: 'call-accept'; callType: CallType }
  | { kind: 'call-reject' }
  | { kind: 'call-end' }
  | { kind: 'call-hold'; onHold: boolean }
  | { kind: 'rtc-offer'; sdp: string }
  | { kind: 'rtc-answer'; sdp: string }
  | { kind: 'rtc-ice'; candidate: string };

export type ThemeMode = 'light' | 'dark' | 'system';

export type ResolvedTheme = 'light' | 'dark';

export type PresenceStatus = 'online' | 'away' | 'offline';

export type RoomParticipant = {
  peerId: string;
  nickname: string;
  status: PresenceStatus;
  joinedAt: number;
};

export type VoiceMessageState = {
  recording: boolean;
  audioUrl: string | null;
  duration: number;
  waveform: number[];
};

export type GroupRoomInfo = {
  roomId: string;
  isGroup: boolean;
  participants: RoomParticipant[];
  maxParticipants: number;
};
