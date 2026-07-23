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

/**
 * Group rooms have no real 1:1 WebRTC connection between every pair of
 * participants (that would require a full mesh of RTCPeerConnections,
 * which isn't implemented). Text chat for group rooms is relayed through
 * this presence store instead: each sender POSTs their message here, and
 * every participant picks up new ones on their regular group poll.
 */
type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: number;
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
  passwordHash?: string;
  messages: ChatMessage[];
};

type PresenceErrorCode =
  | 'BAD_REQUEST'
  | 'ROOM_FULL'
  | 'METHOD_NOT_ALLOWED'
  | 'PRESENCE_FAILED'
  | 'WRONG_PASSWORD'
  | 'CONFLICT_RETRY_EXCEEDED';

type PresenceBody = {
  offer?: string;
  answer?: string;
  ice?: string[];
  type?: RoomType;
  maxPeers?: number;
  nickname?: string;
  targetPeerId?: string;
  passwordHash?: string;
  chatMessage?: { id: string; text: string; senderName?: string; createdAt: number };
  /** Highest message index this client already has, so the response can omit older ones. */
  afterMessageId?: string;
};

const EXPIRY_MS = 1000 * 60 * 30;
const PARTICIPANT_STALE_MS = 1000 * 60 * 2;
const DEFAULT_PRIVATE_MAX_PEERS = 2;
const DEFAULT_GROUP_MAX_PEERS = 10;
const MAX_GROUP_PEERS = 10;
const MAX_ICE_CANDIDATES_PER_PEER = 60;
const MAX_GROUP_MESSAGES = 500;
const MAX_MESSAGE_TEXT_LENGTH = 4000;
const WRITE_RETRY_ATTEMPTS = 4;
const WRITE_RETRY_BASE_DELAY_MS = 60;

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
    return getStore({
      name: 'tempchat-rooms',
      siteID,
      token,
    });
  }

  return getStore({ name: 'tempchat-rooms' });
}

async function getRoomFresh(
  store: ReturnType<typeof getRoomStore>,
  roomId: string,
): Promise<RoomPayload | null> {
  return (await store.get(roomId, {
    type: 'json',
    consistency: 'strong',
  })) as RoomPayload | null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|ECONNRESET|ETIMEDOUT|network|5\d\d|rate.?limit/i.test(message);
}

async function withRetry<T>(
  label: string,
  attempts: number,
  work: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt === attempts - 1) throw error;
      const delay =
        WRITE_RETRY_BASE_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * 40);
      console.warn(`[presence] ${label} attempt ${attempt + 1} failed, retrying in ${delay}ms`, error);
      await sleep(delay);
    }
  }

  throw lastError;
}

function sanitizeRoomId(roomId: string) {
  return roomId.trim().toLowerCase();
}

function sanitizePeerId(peerId: string) {
  return peerId.trim();
}

function sanitizeNickname(nickname?: string) {
  if (!nickname) return undefined;
  const value = nickname.trim().slice(0, 40);
  return value || undefined;
}

function sanitizeRoomType(type?: string): RoomType {
  return type === 'group' ? 'group' : 'private';
}

function sanitizeMaxPeers(value: unknown, type: RoomType) {
  if (type === 'private') return DEFAULT_PRIVATE_MAX_PEERS;
  const fallback = DEFAULT_GROUP_MAX_PEERS;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(2, Math.min(MAX_GROUP_PEERS, Math.floor(num)));
}

function sanitizePasswordHash(passwordHash?: string) {
  if (typeof passwordHash !== 'string') return undefined;
  const value = passwordHash.trim().toLowerCase();
  return value || undefined;
}

function capIceList(candidates: string[]) {
  if (candidates.length <= MAX_ICE_CANDIDATES_PER_PEER) return candidates;
  return candidates.slice(candidates.length - MAX_ICE_CANDIDATES_PER_PEER);
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
    passwordHash: undefined,
    messages: [],
  };
}

function createRoom(
  roomId: string,
  type: RoomType,
  maxPeers: number,
  passwordHash?: string,
): RoomPayload {
  return {
    ...emptyRoom(type, maxPeers),
    roomId,
    passwordHash,
    messages: [],
  };
}

function isFreshRoom(room: RoomPayload | null): room is RoomPayload {
  return !!room && Date.now() - room.updatedAt < EXPIRY_MS;
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function removePeer(room: RoomPayload, peerId: string) {
  room.peers = room.peers.filter((p) => p !== peerId);
  room.participants = room.participants.filter((p) => p.peerId !== peerId);
  delete room.ice[peerId];
  delete room.signals[peerId];

  for (const fromPeer of Object.keys(room.signals)) {
    if (room.signals[fromPeer]?.[peerId]) {
      delete room.signals[fromPeer][peerId];
    }
    if (Object.keys(room.signals[fromPeer] ?? {}).length === 0) {
      delete room.signals[fromPeer];
    }
  }

  if (room.type === 'private') {
    room.offer = undefined;
    room.answer = undefined;
  }
}

function isParticipantStale(p: Participant) {
  return Date.now() - p.lastSeenAt > PARTICIPANT_STALE_MS;
}

function pruneStaleParticipants(room: RoomPayload) {
  const stalePeerIds = new Set(
    (room.participants ?? []).filter(isParticipantStale).map((p) => p.peerId),
  );

  if (stalePeerIds.size === 0) return room;

  for (const peerId of stalePeerIds) {
    removePeer(room, peerId);
  }

  return room;
}

function sanitizeChatMessages(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) return [];

  const seen = new Set<string>();
  const clean: ChatMessage[] = [];

  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const candidate = m as Partial<ChatMessage>;
    if (typeof candidate.id !== 'string' || !candidate.id) continue;
    if (seen.has(candidate.id)) continue;
    if (typeof candidate.senderId !== 'string' || !candidate.senderId) continue;
    if (typeof candidate.text !== 'string' || !candidate.text.trim()) continue;
    if (typeof candidate.createdAt !== 'number') continue;

    seen.add(candidate.id);
    clean.push({
      id: candidate.id,
      senderId: candidate.senderId,
      senderName: sanitizeNickname(candidate.senderName) ?? 'Anon',
      text: candidate.text.slice(0, MAX_MESSAGE_TEXT_LENGTH),
      createdAt: candidate.createdAt,
    });
  }

  clean.sort((a, b) => a.createdAt - b.createdAt);
  if (clean.length > MAX_GROUP_MESSAGES) {
    return clean.slice(clean.length - MAX_GROUP_MESSAGES);
  }
  return clean;
}

function sanitizeRoom(room: RoomPayload): RoomPayload {
  const type: RoomType = room.type ?? 'private';
  const maxPeers = sanitizeMaxPeers(room.maxPeers, type);

  room.peers = dedupeStrings(room.peers ?? []);
  room.participants = (room.participants ?? [])
    .filter((p) => room.peers.includes(p.peerId))
    .reduce<Participant[]>((acc, p) => {
      if (acc.some((x) => x.peerId === p.peerId)) return acc;
      acc.push({
        peerId: p.peerId,
        nickname: sanitizeNickname(p.nickname),
        joinedAt: p.joinedAt,
        lastSeenAt: p.lastSeenAt,
      });
      return acc;
    }, []);

  pruneStaleParticipants(room);

  room.peers = dedupeStrings(room.peers).slice(0, maxPeers);
  room.participants = room.participants.filter((p) => room.peers.includes(p.peerId));

  const ice: Record<string, string[]> = {};
  for (const peerId of room.peers) {
    const list = Array.isArray(room.ice?.[peerId]) ? room.ice[peerId] : [];
    ice[peerId] = capIceList(list.filter((v): v is string => typeof v === 'string'));
  }

  const signals: Record<string, Record<string, PeerSignalState>> = {};
  for (const fromPeer of room.peers) {
    const source = room.signals?.[fromPeer];
    if (!source || typeof source !== 'object') continue;

    const nextTargetMap: Record<string, PeerSignalState> = {};
    for (const toPeer of Object.keys(source)) {
      if (!room.peers.includes(toPeer)) continue;
      const item = source[toPeer];
      nextTargetMap[toPeer] = {
        offer: typeof item?.offer === 'string' ? item.offer : undefined,
        answer: typeof item?.answer === 'string' ? item.answer : undefined,
        ice: capIceList(
          Array.isArray(item?.ice)
            ? item.ice.filter((v): v is string => typeof v === 'string')
            : [],
        ),
      };
    }

    if (Object.keys(nextTargetMap).length > 0) {
      signals[fromPeer] = nextTargetMap;
    }
  }

  return {
    roomId: room.roomId,
    peers: room.peers,
    participants: room.participants,
    offer: type === 'private' && room.peers.length > 0 ? room.offer : undefined,
    answer: type === 'private' && room.peers.length > 0 ? room.answer : undefined,
    ice,
    updatedAt: room.updatedAt,
    createdAt: room.createdAt,
    type,
    maxPeers,
    signals,
    passwordHash: sanitizePasswordHash(room.passwordHash),
    messages: type === 'group' ? sanitizeChatMessages(room.messages) : [],
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
      throw new Error('type must be private or group');
    }
    next.type = body.type;
  }

  if (body.maxPeers !== undefined) {
    if (typeof body.maxPeers !== 'number') throw new Error('maxPeers must be a number');
    next.maxPeers = body.maxPeers;
  }

  if (body.nickname !== undefined) {
    if (typeof body.nickname !== 'string') throw new Error('nickname must be a string');
    next.nickname = body.nickname;
  }

  if (body.targetPeerId !== undefined) {
    if (typeof body.targetPeerId !== 'string') throw new Error('targetPeerId must be a string');
    next.targetPeerId = body.targetPeerId;
  }

  if (body.passwordHash !== undefined) {
    if (typeof body.passwordHash !== 'string') throw new Error('passwordHash must be a string');
    next.passwordHash = body.passwordHash;
  }

  if (body.chatMessage !== undefined) {
    const cm = body.chatMessage;
    if (!cm || typeof cm !== 'object') throw new Error('chatMessage must be an object');
    const c = cm as Record<string, unknown>;
    if (typeof c.id !== 'string' || !c.id) throw new Error('chatMessage.id is required');
    if (typeof c.text !== 'string' || !c.text.trim()) throw new Error('chatMessage.text is required');
    if (typeof c.createdAt !== 'number') throw new Error('chatMessage.createdAt must be a number');
    next.chatMessage = {
      id: c.id,
      text: c.text,
      senderName: typeof c.senderName === 'string' ? c.senderName : undefined,
      createdAt: c.createdAt,
    };
  }

  return next;
}

function isJoinOnlyRequest(body: PresenceBody) {
  return (
    body.offer === undefined &&
    body.answer === undefined &&
    body.ice === undefined &&
    body.chatMessage === undefined
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

async function saveRoom(
  store: ReturnType<typeof getRoomStore>,
  roomId: string,
  room: RoomPayload,
) {
  await withRetry('saveRoom', WRITE_RETRY_ATTEMPTS, () => store.setJSON(roomId, room));
}

async function loadMutateSave(
  store: ReturnType<typeof getRoomStore>,
  roomId: string,
  mutate: (room: RoomPayload) => RoomPayload | Promise<RoomPayload>,
): Promise<RoomPayload> {
  let lastSeenUpdatedAt = -1;

  for (let attempt = 0; attempt < WRITE_RETRY_ATTEMPTS; attempt += 1) {
    const existing = await withRetry('loadRoom', WRITE_RETRY_ATTEMPTS, () =>
      getRoomFresh(store, roomId),
    );

    let currentRoom = isFreshRoom(existing) ? sanitizeRoom(existing) : emptyRoom();
    if (existing && !isFreshRoom(existing)) {
      await store.delete(roomId).catch(() => {});
    }

    const beforeMutateUpdatedAt = currentRoom.updatedAt;
    const mutated = await mutate(currentRoom);
    mutated.updatedAt = Date.now();
    const finalRoom = sanitizeRoom(mutated);

    if (attempt === 0 || beforeMutateUpdatedAt === lastSeenUpdatedAt) {
      lastSeenUpdatedAt = beforeMutateUpdatedAt;
      try {
        await saveRoom(store, roomId, finalRoom);
        return finalRoom;
      } catch (error) {
        if (attempt === WRITE_RETRY_ATTEMPTS - 1) throw error;
        await sleep(WRITE_RETRY_BASE_DELAY_MS * (attempt + 1));
      }
    } else {
      lastSeenUpdatedAt = beforeMutateUpdatedAt;
    }
  }

  throw new PresenceHandledError(
    409,
    'CONFLICT_RETRY_EXCEEDED',
    'Could not update room due to concurrent changes.',
  );
}

class PresenceHandledError extends Error {
  statusCode: number;
  code: PresenceErrorCode;

  constructor(statusCode: number, code: PresenceErrorCode, message: string) {
    super(message);
    this.name = 'PresenceHandledError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
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

    if (event.httpMethod === 'GET') {
      const existing = await withRetry('getRoom', WRITE_RETRY_ATTEMPTS, () =>
        getRoomFresh(store, roomId),
      );

      let room = isFreshRoom(existing) ? sanitizeRoom(existing) : emptyRoom();
      if (existing && !isFreshRoom(existing)) {
        await store.delete(roomId).catch(() => {});
      }

      room = sanitizeRoom(pruneStaleParticipants(room));

      return json(200, room.roomId ? room : { ...room, roomId });
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

      const nickname = sanitizeNickname(body.nickname);
      const passwordHash = sanitizePasswordHash(body.passwordHash);
      const joinOnly = isJoinOnlyRequest(body);

      try {
        const result = await loadMutateSave(store, roomId, async (room) => {
          room = sanitizeRoom(pruneStaleParticipants(room));

          if (!room.roomId) {
            if (!joinOnly) {
              throw new PresenceHandledError(
                400,
                'BAD_REQUEST',
                'Room does not exist yet. Join/create the room before signaling.',
              );
            }

            const requestedType = sanitizeRoomType(body.type);
            const requestedMaxPeers = sanitizeMaxPeers(body.maxPeers, requestedType);

            if (!passwordHash) {
              throw new PresenceHandledError(
                400,
                'BAD_REQUEST',
                'passwordHash is required for room creation',
              );
            }

            room = createRoom(roomId, requestedType, requestedMaxPeers, passwordHash);
          } else if (joinOnly) {
            if (!passwordHash) {
              throw new PresenceHandledError(400, 'BAD_REQUEST', 'passwordHash is required');
            }

            if ((room.passwordHash ?? '') !== passwordHash) {
              throw new PresenceHandledError(401, 'WRONG_PASSWORD', 'Wrong password');
            }

            room = sanitizeRoom(pruneStaleParticipants(room));

            const alreadyJoined = room.peers.includes(peerId);
            const maxPeers = sanitizeMaxPeers(room.maxPeers, room.type);

            if (!alreadyJoined && room.peers.length >= maxPeers) {
              throw new PresenceHandledError(
                409,
                'ROOM_FULL',
                `This room is full. Maximum ${maxPeers} participants allowed.`,
              );
            }

            ensureParticipant(room, peerId, nickname);
            room = sanitizeRoom(room);

            return room;
          }

          ensureParticipant(room, peerId, nickname);

          if (body.offer) {
            if (room.type === 'private' && !body.targetPeerId) {
              room.offer = body.offer;
            } else if (body.targetPeerId) {
              room.signals[peerId] ??= {};
              room.signals[peerId][body.targetPeerId] ??= { ice: [] };
              room.signals[peerId][body.targetPeerId].offer = body.offer;
            }
          }

          if (body.answer) {
            if (room.type === 'private' && !body.targetPeerId) {
              room.answer = body.answer;
            } else if (body.targetPeerId) {
              room.signals[peerId] ??= {};
              room.signals[peerId][body.targetPeerId] ??= { ice: [] };
              room.signals[peerId][body.targetPeerId].answer = body.answer;
            }
          }

          if (body.ice?.length) {
            if (room.type === 'private' && !body.targetPeerId) {
              room.ice[peerId] = capIceList([...(room.ice[peerId] ?? []), ...body.ice]);
            } else if (body.targetPeerId) {
              room.signals[peerId] ??= {};
              room.signals[peerId][body.targetPeerId] ??= { ice: [] };
              room.signals[peerId][body.targetPeerId].ice = capIceList([
                ...room.signals[peerId][body.targetPeerId].ice,
                ...body.ice,
              ]);
            }
          }

          if (body.chatMessage && room.type === 'group') {
            const existing = room.messages ?? [];
            if (!existing.some((m) => m.id === body.chatMessage!.id)) {
              room.messages = [
                ...existing,
                {
                  id: body.chatMessage.id,
                  senderId: peerId,
                  senderName: sanitizeNickname(body.chatMessage.senderName) ?? nickname ?? 'Anon',
                  text: body.chatMessage.text.slice(0, MAX_MESSAGE_TEXT_LENGTH),
                  createdAt: body.chatMessage.createdAt,
                },
              ];
            }
          }

          return room;
        });

        return json(200, result);
      } catch (error) {
        if (error instanceof PresenceHandledError) {
          return errorJson(error.statusCode, error.code, error.message);
        }
        throw error;
      }
    }

    if (event.httpMethod === 'DELETE') {
      const existing = await withRetry('getRoom', WRITE_RETRY_ATTEMPTS, () =>
        getRoomFresh(store, roomId),
      );

      let room = isFreshRoom(existing) ? sanitizeRoom(existing) : emptyRoom();
      if (existing && !isFreshRoom(existing)) {
        await store.delete(roomId).catch(() => {});
      }

      if (!room.roomId) {
        return json(200, { ...emptyRoom(), roomId });
      }

      if (peerId) {
        removePeer(room, peerId);
        room = sanitizeRoom(pruneStaleParticipants(room));

        if (room.peers.length === 0) {
          await store.delete(roomId).catch(() => {});
          return json(200, { ...emptyRoom(room.type, room.maxPeers), roomId });
        }

        room.updatedAt = Date.now();
        await saveRoom(store, roomId, room);
        return json(200, room);
      }

      await store.delete(roomId).catch(() => {});
      return json(200, { ...emptyRoom(), roomId });
    }

    return errorJson(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  } catch (error) {
    console.error('presence function error', error);
    if (error instanceof PresenceHandledError) {
      return errorJson(error.statusCode, error.code, error.message);
    }
    return errorJson(
      500,
      'PRESENCE_FAILED',
      'presence failed',
      error instanceof Error ? error.message : String(error),
    );
  }
};