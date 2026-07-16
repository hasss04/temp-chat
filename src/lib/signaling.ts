import { publishRoomWake } from './realtime';

const API_BASE = import.meta.env.VITE_API_BASE || '/.netlify/functions';

export type ParticipantPayload = {
  peerId: string;
  nickname?: string;
  joinedAt: number;
  lastSeenAt: number;
};

export type PeerSignalState = {
  offer?: string;
  answer?: string;
  ice: string[];
};

export type RoomPayload = {
  roomId?: string;
  peers: string[];
  participants?: ParticipantPayload[];
  offer?: string;
  answer?: string;
  ice: Record<string, string[]>;
  updatedAt: number;
  createdAt?: number;
  type?: 'private' | 'group';
  maxPeers?: number;
  signals?: Record<string, Record<string, PeerSignalState>>;
};

export type SignalErrorCode =
  | 'ROOM_FULL'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'PRESENCE_FAILED'
  | 'UNKNOWN';

type ErrorPayload = {
  code?: SignalErrorCode;
  message?: string;
  detail?: string;
};

export class SignalError extends Error {
  code: SignalErrorCode;
  status: number;
  detail?: string;
  constructor(code: SignalErrorCode, message: string, status = 500, detail?: string) {
    super(message);
    this.name = 'SignalError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

async function call(roomId: string, method: string, peerId?: string, body?: unknown) {
  const qs = new URLSearchParams({ roomId });
  if (peerId) qs.set('peerId', peerId);
  const res = await fetch(`${API_BASE}/presence?${qs.toString()}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let payload: ErrorPayload | null = null;
    try {
      payload = (await res.json()) as ErrorPayload;
    } catch {
      payload = null;
    }
    throw new SignalError(
      payload?.code ?? 'UNKNOWN',
      payload?.message ?? `presence ${method} failed`,
      res.status,
      payload?.detail,
    );
  }
  return (await res.json()) as RoomPayload;
}

export const getRoom = (roomId: string) => call(roomId, 'GET');

export const createRoom = async (
  roomId: string,
  peerId: string,
  options?: {
    type?: 'private' | 'group';
    nickname?: string;
    maxPeers?: number;
  },
) => {
  const room = await call(roomId, 'POST', peerId, {
    type: options?.type ?? 'private',
    nickname: options?.nickname,
    maxPeers: options?.maxPeers,
  });
  publishRoomWake(roomId);
  return room;
};

export const joinRoom = async (roomId: string, peerId: string, nickname?: string) => {
  const room = await call(roomId, 'POST', peerId, nickname ? { nickname } : {});
  // Tell everyone already in the room "a new peer just showed up" so their
  // waiting/polling loop wakes immediately instead of on its next tick.
  publishRoomWake(roomId);
  return room;
};

export const leaveRoom = async (roomId: string, peerId?: string) => {
  try {
    const room = await call(roomId, 'DELETE', peerId);
    publishRoomWake(roomId);
    return room;
  } catch {
    return undefined;
  }
};

export const postOffer = async (
  roomId: string,
  peerId: string,
  offer: RTCSessionDescriptionInit,
  targetPeerId?: string,
) => {
  const room = await call(roomId, 'POST', peerId, {
    offer: JSON.stringify(offer),
    ...(targetPeerId ? { targetPeerId } : {}),
  });
  publishRoomWake(roomId);
  return room;
};

export const postAnswer = async (
  roomId: string,
  peerId: string,
  answer: RTCSessionDescriptionInit,
  targetPeerId?: string,
) => {
  const room = await call(roomId, 'POST', peerId, {
    answer: JSON.stringify(answer),
    ...(targetPeerId ? { targetPeerId } : {}),
  });
  publishRoomWake(roomId);
  return room;
};

export const postIce = async (
  roomId: string,
  peerId: string,
  candidate: RTCIceCandidateInit,
  targetPeerId?: string,
) => {
  const room = await call(roomId, 'POST', peerId, {
    ice: [JSON.stringify(candidate)],
    ...(targetPeerId ? { targetPeerId } : {}),
  });
  publishRoomWake(roomId);
  return room;
};

/**
 * Pure, synchronous role derivation from a room snapshot you already have
 * (e.g. the response from joinRoom). No network round trip, no polling.
 * Returns 'waiting' only when you are genuinely the first peer in the room.
 */
export function deriveRole(
  room: RoomPayload,
  peerId: string,
): 'offerer' | 'answerer' | 'waiting' {
  if (room.type === 'group') {
    const sorted = [...room.peers].sort();
    return sorted[0] === peerId ? 'offerer' : 'answerer';
  }
  if (room.peers.length < 2) return 'waiting';
  const sorted = [...room.peers].sort();
  return sorted[0] === peerId ? 'offerer' : 'answerer';
}