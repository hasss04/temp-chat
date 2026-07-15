import type { Handler } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

type RoomType = 'private' | 'group';

type Participant = {
  peerId: string;
  nickname?: string;
  joinedAt: number;
  lastSeenAt: number;
};

type PeerSignalState = {
  offer?: string;
  answer?: string;
  ice: string[];
};

type RoomPayload = {
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
};

type PresenceErrorCode =
  | 'BAD_REQUEST'
  | 'ROOM_FULL'
  | 'METHOD_NOT_ALLOWED'
  | 'PRESENCE_FAILED';

type PresenceBody = {
  offer?: string;
  answer?: string;
  ice?: string[];
  type?: RoomType;
  maxPeers?: number;
  nickname?: string;
  targetPeerId?: string;
};

const EXPIRY_MS = 1000 * 60 * 30;
const DEFAULT_PRIVATE_MAX_PEERS = 2;
const DEFAULT_GROUP_MAX_PEERS = 12;
const MAX_GROUP_PEERS = 50;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders,
    },
    body: JSON.stringify(body),
  };
}

function errorJson(
  statusCode: number,
  code: PresenceErrorCode,
  message: string,
  detail?: string,
) {
  return json(statusCode, {
    code,
    message,
    ...(detail ? { detail } : {}),
  });
}

function getRoomStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;

  if (siteID && token) {
    return getStore({ name: 'tempchat-rooms', siteID, token });
  }

  return getStore({ name: 'tempchat-rooms' });
}

function sanitizeRoomId(roomId: string): string {
  return roomId.trim().toLowerCase();
}

function sanitizePeerId(peerId: string): string {
  return peerId.trim();
}

function sanitizeNickname(nickname?: string): string | undefined {
  if (!nickname) return undefined;
  const value = nickname.trim().slice(0, 40);
  return value || undefined;
}

function sanitizeRoomType(type?: string): RoomType {
  return type === 'group' ? 'group' : 'private';
}

function sanitizeMaxPeers(value: unknown, type: RoomType): number {
  const fallback = type === 'group' ? DEFAULT_GROUP_MAX_PEERS : DEFAULT_PRIVATE_MAX_PEERS;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;

  if (type === 'private') return DEFAULT_PRIVATE_MAX_PEERS;
  return Math.max(2, Math.min(MAX_GROUP_PEERS, Math.floor(num)));
}

function emptyRoom(type: RoomType = 'private', maxPeers?: number): RoomPayload {
  const resolvedMaxPeers =
    type === 'group'
      ? maxPeers ?? DEFAULT_GROUP_MAX_PEERS
      : DEFAULT_PRIVATE_MAX_PEERS;

  return {
    roomId: '',
    peers: [],
    participants: [],
    offer: undefined,
    answer: undefined,
    ice: {},
    updatedAt: Date.now(),
    createdAt: Date.now(),
    type,
    maxPeers: resolvedMaxPeers,
    signals: {},
  };
}

function createRoom(roomId: string, type: RoomType, maxPeers: number): RoomPayload {
  return {
    ...emptyRoom(type, maxPeers),
    roomId,
  };
}

function isFreshRoom(room: RoomPayload | null): room is RoomPayload {
  return !!room && Date.now() - room.updatedAt < EXPIRY_MS;
}

function sanitizeRoom(room: RoomPayload): RoomPayload {
  const type: RoomType = room.type ?? 'private';
  const maxPeers = sanitizeMaxPeers(room.maxPeers, type);

  const uniquePeers = Array.from(new Set(room.peers)).slice(0, maxPeers);

  const participants = room.participants
    .filter((p) => uniquePeers.includes(p.peerId))
    .map((p) => ({
      peerId: p.peerId,
      nickname: sanitizeNickname(p.nickname),
      joinedAt: p.joinedAt,
      lastSeenAt: p.lastSeenAt,
    }));

  const ice: Record<string, string[]> = {};
  for (const peerId of uniquePeers) {
    ice[peerId] = Array.isArray(room.ice?.[peerId]) ? room.ice[peerId] : [];
  }

  const signals: Record<string, Record<string, PeerSignalState>> = {};
  for (const fromPeer of uniquePeers) {
    const source = room.signals?.[fromPeer];
    if (!source || typeof source !== 'object') continue;

    const nextTargetMap: Record<string, PeerSignalState> = {};
    for (const toPeer of Object.keys(source)) {
      if (!uniquePeers.includes(toPeer)) continue;
      const item = source[toPeer];
      nextTargetMap[toPeer] = {
        offer: typeof item?.offer === 'string' ? item.offer : undefined,
        answer: typeof item?.answer === 'string' ? item.answer : undefined,
        ice: Array.isArray(item?.ice) ? item.ice.filter((v) => typeof v === 'string') : [],
      };
    }
    signals[fromPeer] = nextTargetMap;
  }

  const shouldKeepLegacyOffer = uniquePeers.length > 0 && type === 'private';
  const shouldKeepLegacyAnswer = uniquePeers.length > 0 && type === 'private';

  return {
    roomId: room.roomId,
    peers: uniquePeers,
    participants,
    offer: shouldKeepLegacyOffer ? room.offer : undefined,
    answer: shouldKeepLegacyAnswer ? room.answer : undefined,
    ice,
    updatedAt: room.updatedAt,
    createdAt: room.createdAt,
    type,
    maxPeers,
    signals,
  };
}

function parseBody(rawBody: string | null): PresenceBody {
  if (!rawBody) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new Error('Invalid JSON body');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Request body must be an object');
  }

  const body = parsed as Record<string, unknown>;
  const next: PresenceBody = {};

  if (body.offer !== undefined) {
    if (typeof body.offer !== 'string') throw new Error('offer must be a string');
    next.offer = body.offer;
  }

  if (body.answer !== undefined) {
    if (typeof body.answer !== 'string') throw new Error('answer must be a string');
    next.answer = body.answer;
  }

  if (body.ice !== undefined) {
    if (!Array.isArray(body.ice) || !body.ice.every((v) => typeof v === 'string')) {
      throw new Error('ice must be an array of strings');
    }
    next.ice = body.ice;
  }

  if (body.type !== undefined) {
    if (body.type !== 'private' && body.type !== 'group') {
      throw new Error('type must be "private" or "group"');
    }
    next.type = body.type;
  }

  if (body.maxPeers !== undefined) {
    if (typeof body.maxPeers !== 'number') {
      throw new Error('maxPeers must be a number');
    }
    next.maxPeers = body.maxPeers;
  }

  if (body.nickname !== undefined) {
    if (typeof body.nickname !== 'string') {
      throw new Error('nickname must be a string');
    }
    next.nickname = body.nickname;
  }

  if (body.targetPeerId !== undefined) {
    if (typeof body.targetPeerId !== 'string') {
      throw new Error('targetPeerId must be a string');
    }
    next.targetPeerId = body.targetPeerId;
  }

  return next;
}

function isJoinOnlyRequest(body: PresenceBody) {
  return (
    body.offer === undefined &&
    body.answer === undefined &&
    body.ice === undefined
  );
}

function ensureParticipant(room: RoomPayload, peerId: string, nickname?: string) {
  if (!room.peers.includes(peerId)) {
    room.peers.push(peerId);
  }

  const existing = room.participants.find((p) => p.peerId === peerId);
  if (existing) {
    existing.lastSeenAt = Date.now();
    if (nickname) existing.nickname = nickname;
    return;
  }

  room.participants.push({
    peerId,
    nickname,
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
  });
}

function removePeer(room: RoomPayload, peerId: string) {
  room.peers = room.peers.filter((p) => p !== peerId);
  room.participants = room.participants.filter((p) => p.peerId !== peerId);
  delete room.ice[peerId];

  if (room.signals[peerId]) {
    delete room.signals[peerId];
  }

  for (const fromPeer of Object.keys(room.signals)) {
    if (room.signals[fromPeer]?.[peerId]) {
      delete room.signals[fromPeer][peerId];
    }
  }

  if (room.type === 'private') {
    room.offer = undefined;
    room.answer = undefined;
  }
}

async function saveRoom(
  store: ReturnType<typeof getRoomStore>,
  roomId: string,
  room: RoomPayload,
) {
  await store.setJSON(roomId, room);
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }

  try {
    const rawRoomId = event.queryStringParameters?.roomId ?? '';
    const rawPeerId = event.queryStringParameters?.peerId ?? '';

    const roomId = sanitizeRoomId(rawRoomId);
    const peerId = sanitizePeerId(rawPeerId);

    if (!roomId) {
      return errorJson(400, 'BAD_REQUEST', 'roomId is required');
    }

    const store = getRoomStore();
    const existing = (await store.get(roomId, { type: 'json' })) as RoomPayload | null;

    let room = isFreshRoom(existing) ? sanitizeRoom(existing) : emptyRoom();

    if (existing && !isFreshRoom(existing)) {
      await store.delete(roomId);
      room = emptyRoom();
    }

    if (event.httpMethod === 'GET') {
      return json(
        200,
        room.roomId
          ? room
          : {
              ...room,
              roomId,
            },
      );
    }

    if (event.httpMethod === 'POST') {
      if (!peerId) {
        return errorJson(400, 'BAD_REQUEST', 'peerId is required');
      }

      let body: PresenceBody;
      try {
        body = parseBody(event.body ?? null);
      } catch (error) {
        return errorJson(
          400,
          'BAD_REQUEST',
          'Invalid request body',
          error instanceof Error ? error.message : String(error),
        );
      }

      if (!room.roomId) {
        const requestedType = sanitizeRoomType(body.type);
        const requestedMaxPeers = sanitizeMaxPeers(body.maxPeers, requestedType);
        room = createRoom(roomId, requestedType, requestedMaxPeers);
      }

      const nickname = sanitizeNickname(body.nickname);
      const alreadyJoined = room.peers.includes(peerId);
      const maxPeers = sanitizeMaxPeers(room.maxPeers, room.type);

      if (!alreadyJoined && room.peers.length >= maxPeers) {
        return errorJson(
          409,
          'ROOM_FULL',
          `This room is full (${maxPeers} participants maximum).`,
        );
      }

      ensureParticipant(room, peerId, nickname);

      if (isJoinOnlyRequest(body)) {
        room.updatedAt = Date.now();
        room = sanitizeRoom(room);
        await saveRoom(store, roomId, room);
        return json(200, room);
      }

      if (body.offer) {
        if (room.type === 'private' || !body.targetPeerId) {
          room.offer = body.offer;
        } else {
          room.signals[peerId] ??= {};
          room.signals[peerId][body.targetPeerId] ??= { ice: [] };
          room.signals[peerId][body.targetPeerId].offer = body.offer;
        }
      }

      if (body.answer) {
        if (room.type === 'private' || !body.targetPeerId) {
          room.answer = body.answer;
        } else {
          room.signals[peerId] ??= {};
          room.signals[peerId][body.targetPeerId] ??= { ice: [] };
          room.signals[peerId][body.targetPeerId].answer = body.answer;
        }
      }

      if (body.ice?.length) {
        if (room.type === 'private' || !body.targetPeerId) {
          room.ice[peerId] = [...(room.ice[peerId] ?? []), ...body.ice];
        } else {
          room.signals[peerId] ??= {};
          room.signals[peerId][body.targetPeerId] ??= { ice: [] };
          room.signals[peerId][body.targetPeerId].ice.push(...body.ice);
        }
      }

      room.updatedAt = Date.now();
      room = sanitizeRoom(room);
      await saveRoom(store, roomId, room);
      return json(200, room);
    }

    if (event.httpMethod === 'DELETE') {
      if (!room.roomId) {
        return json(200, { ...emptyRoom(), roomId });
      }

      if (peerId) {
        removePeer(room, peerId);

        if (room.peers.length === 0) {
          await store.delete(roomId);
          return json(200, { ...emptyRoom(room.type, room.maxPeers), roomId });
        }

        room.updatedAt = Date.now();
        room = sanitizeRoom(room);
        await saveRoom(store, roomId, room);
        return json(200, room);
      }

      await store.delete(roomId);
      return json(200, { ...emptyRoom(), roomId });
    }

    return errorJson(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  } catch (error) {
    console.error('presence function error:', error);

    return errorJson(
      500,
      'PRESENCE_FAILED',
      'presence failed',
      error instanceof Error ? error.message : String(error),
    );
  }
};