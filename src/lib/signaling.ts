export type RoomType = 'private' | 'group';

export type Participant = {
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
  roomId: string;
  peers: string[];
  participants: Participant[];
  offer?: string;
  answer?: string;
  ice: Record<string, string[]>;
  updatedAt: number;
  createdAt: number;
  type: RoomType;
  maxPeers: number;
  signals: Record<string, Record<string, PeerSignalState>>;
  passwordHash?: string;
};

export type PresenceErrorCode =
  | 'BAD_REQUEST'
  | 'ROOM_FULL'
  | 'METHOD_NOT_ALLOWED'
  | 'PRESENCE_FAILED'
  | 'WRONG_PASSWORD';

type PresenceErrorResponse = {
  code?: PresenceErrorCode;
  message?: string;
  detail?: string;
};

export class SignalError extends Error {
  code: PresenceErrorCode | 'UNKNOWN';
  detail?: string;

  constructor(
    message: string,
    code: PresenceErrorCode | 'UNKNOWN' = 'UNKNOWN',
    detail?: string,
  ) {
    super(message);
    this.name = 'SignalError';
    this.code = code;
    this.detail = detail;
  }
}

const PRESENCE_URL = '/.netlify/functions/presence';

async function sha256(value: string): Promise<string> {
  const normalized = value.trim();
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', data);

  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);

  const text = await res.text();
  let data: unknown = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const err = (data ?? {}) as PresenceErrorResponse;
    throw new SignalError(
      err.message || `Request failed with status ${res.status}`,
      err.code || 'UNKNOWN',
      err.detail,
    );
  }

  return data as T;
}

function qs(params: Record<string, string>) {
  return new URLSearchParams(params).toString();
}

function normalizeRoomId(roomId: string) {
  return roomId.trim().toLowerCase();
}

function normalizePeerId(peerId: string) {
  return peerId.trim();
}

function normalizeNickname(nickname?: string) {
  const value = nickname?.trim();
  return value ? value.slice(0, 40) : undefined;
}

function normalizeSecret(secret: string) {
  return secret.trim();
}

export async function hashRoomSecret(secret: string): Promise<string> {
  const normalized = normalizeSecret(secret);
  if (!normalized) {
    throw new SignalError('Passphrase is required', 'BAD_REQUEST');
  }
  return sha256(normalized);
}

export async function getRoom(roomId: string): Promise<RoomPayload> {
  return request<RoomPayload>(
    `${PRESENCE_URL}?${qs({
      roomId: normalizeRoomId(roomId),
    })}`,
  );
}

export async function createRoom(
  roomId: string,
  peerId: string,
  options: {
    type: RoomType;
    nickname?: string;
    maxPeers?: number;
    secret: string;
  },
): Promise<RoomPayload> {
  const normalizedSecret = normalizeSecret(options.secret);
  if (!normalizedSecret) {
    throw new SignalError('Passphrase is required', 'BAD_REQUEST');
  }

  const passwordHash = await hashRoomSecret(normalizedSecret);
  const safeMaxPeers = options.type === 'group' ? Math.max(2, Math.min(options.maxPeers ?? 10, 10)) : 2;

  return request<RoomPayload>(
    `${PRESENCE_URL}?${qs({
      roomId: normalizeRoomId(roomId),
      peerId: normalizePeerId(peerId),
    })}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: options.type,
        nickname: normalizeNickname(options.nickname),
        maxPeers: safeMaxPeers,
        passwordHash,
      }),
    },
  );
}

export async function joinRoom(
  roomId: string,
  peerId: string,
  nickname: string | undefined,
  secret: string,
): Promise<RoomPayload> {
  const normalizedSecret = normalizeSecret(secret);
  if (!normalizedSecret) {
    throw new SignalError('Passphrase is required', 'BAD_REQUEST');
  }

  const passwordHash = await hashRoomSecret(normalizedSecret);

  return request<RoomPayload>(
    `${PRESENCE_URL}?${qs({
      roomId: normalizeRoomId(roomId),
      peerId: normalizePeerId(peerId),
    })}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: normalizeNickname(nickname),
        passwordHash,
      }),
    },
  );
}

export async function leaveRoom(roomId: string, peerId: string): Promise<RoomPayload> {
  return request<RoomPayload>(
    `${PRESENCE_URL}?${qs({
      roomId: normalizeRoomId(roomId),
      peerId: normalizePeerId(peerId),
    })}`,
    { method: 'DELETE' },
  );
}

export async function postOffer(
  roomId: string,
  peerId: string,
  offer: RTCSessionDescriptionInit,
  targetPeerId?: string,
): Promise<RoomPayload> {
  return request<RoomPayload>(
    `${PRESENCE_URL}?${qs({
      roomId: normalizeRoomId(roomId),
      peerId: normalizePeerId(peerId),
    })}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        offer: JSON.stringify(offer),
        ...(targetPeerId ? { targetPeerId: normalizePeerId(targetPeerId) } : {}),
      }),
    },
  );
}

export async function postAnswer(
  roomId: string,
  peerId: string,
  answer: RTCSessionDescriptionInit,
  targetPeerId?: string,
): Promise<RoomPayload> {
  return request<RoomPayload>(
    `${PRESENCE_URL}?${qs({
      roomId: normalizeRoomId(roomId),
      peerId: normalizePeerId(peerId),
    })}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answer: JSON.stringify(answer),
        ...(targetPeerId ? { targetPeerId: normalizePeerId(targetPeerId) } : {}),
      }),
    },
  );
}

export async function postIce(
  roomId: string,
  peerId: string,
  candidate: RTCIceCandidateInit,
  targetPeerId?: string,
): Promise<RoomPayload> {
  return request<RoomPayload>(
    `${PRESENCE_URL}?${qs({
      roomId: normalizeRoomId(roomId),
      peerId: normalizePeerId(peerId),
    })}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ice: [JSON.stringify(candidate)],
        ...(targetPeerId ? { targetPeerId: normalizePeerId(targetPeerId) } : {}),
      }),
    },
  );
}

export function deriveRole(room: RoomPayload, peerId: string): 'waiting' | 'offerer' | 'answerer' {
  const peers = room.peers ?? [];
  const normalizedPeerId = normalizePeerId(peerId);

  if (!peers.includes(normalizedPeerId)) return 'waiting';
  if (room.type === 'group') return 'waiting';
  if (peers.length < 2) return 'waiting';

  return peers[0] === normalizedPeerId ? 'offerer' : 'answerer';
}