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

export const createRoom = (
  roomId: string,
  peerId: string,
  options?: {
    type?: 'private' | 'group';
    nickname?: string;
    maxPeers?: number;
  },
) =>
  call(roomId, 'POST', peerId, {
    type: options?.type ?? 'private',
    nickname: options?.nickname,
    maxPeers: options?.maxPeers,
  });

export const joinRoom = (roomId: string, peerId: string, nickname?: string) =>
  call(roomId, 'POST', peerId, nickname ? { nickname } : {});

export const leaveRoom = (roomId: string, peerId?: string) =>
  call(roomId, 'DELETE', peerId).catch(() => {});

export const postOffer = (
  roomId: string,
  peerId: string,
  offer: RTCSessionDescriptionInit,
  targetPeerId?: string,
) =>
  call(roomId, 'POST', peerId, {
    offer: JSON.stringify(offer),
    ...(targetPeerId ? { targetPeerId } : {}),
  });

export const postAnswer = (
  roomId: string,
  peerId: string,
  answer: RTCSessionDescriptionInit,
  targetPeerId?: string,
) =>
  call(roomId, 'POST', peerId, {
    answer: JSON.stringify(answer),
    ...(targetPeerId ? { targetPeerId } : {}),
  });

export const postIce = (
  roomId: string,
  peerId: string,
  candidate: RTCIceCandidateInit,
  targetPeerId?: string,
) =>
  call(roomId, 'POST', peerId, {
    ice: [JSON.stringify(candidate)],
    ...(targetPeerId ? { targetPeerId } : {}),
  });

export async function determineRole(
  roomId: string,
  peerId: string,
): Promise<'offerer' | 'answerer'> {
  for (let i = 0; i < 20; i++) {
    try {
      const room = await getRoom(roomId);

      if (room.type === 'group') {
        const sorted = [...room.peers].sort();
        return sorted[0] === peerId ? 'offerer' : 'answerer';
      }

      if (room.offer && room.peers.length > 1) return 'answerer';

      if (room.peers.length >= 2) {
        const sorted = [...room.peers].sort();
        return sorted[0] === peerId ? 'offerer' : 'answerer';
      }
    } catch (error) {
      if (error instanceof SignalError && error.code === 'ROOM_FULL') {
        throw error;
      }
    }

    await new Promise((r) => setTimeout(r, 400));
  }

  return 'offerer';
}