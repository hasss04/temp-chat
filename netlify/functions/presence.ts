import type { Handler } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

type RoomPayload = {
  peers: string[];
  offer?: string;
  answer?: string;
  ice: Record<string, string[]>; // peerId to candidates
  updatedAt: number;
};

const EXPIRY_MS = 1000 * 60 * 30; // auto-expire after 30 min if idle for room chat.

function emptyRoom(): RoomPayload {
  return { peers: [], ice: {}, updatedAt: Date.now() };
}

export const handler: Handler = async (event) => {
  const store = getStore('tempchat-rooms');
  const roomId = event.queryStringParameters?.roomId;
  const peerId = event.queryStringParameters?.peerId;

  if (!roomId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'roomId is required' }) };
  }

  const existing = (await store.get(roomId, { type: 'json' })) as RoomPayload | null;
  let room: RoomPayload = existing && Date.now() - existing.updatedAt < EXPIRY_MS ? existing : emptyRoom();

  if (event.httpMethod === 'GET') {
    return json(room);
  }

  if (event.httpMethod === 'POST') {
    if (!peerId) return { statusCode: 400, body: JSON.stringify({ error: 'peerId is required' }) };
    const body = event.body ? JSON.parse(event.body) : {};

    if (!room.peers.includes(peerId)) room.peers.push(peerId);
    if (body.offer) room.offer = body.offer;
    if (body.answer) room.answer = body.answer;
    if (body.ice) {
      room.ice[peerId] = [...(room.ice[peerId] ?? []), ...body.ice];
    }
    room.updatedAt = Date.now();

    await store.setJSON(roomId, room);
    return json(room);
  }

  if (event.httpMethod === 'DELETE') {
    if (peerId) {
      room.peers = room.peers.filter((p) => p !== peerId);
      delete room.ice[peerId];
      await store.setJSON(roomId, room);
    } else {
      await store.delete(roomId);
    }
    return json(room);
  }

  return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
};

function json(body: unknown) {
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}