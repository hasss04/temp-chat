import type { Handler } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

type RoomPayload = {
  peers: string[];
  offer?: string;
  answer?: string;
  ice: Record<string, string[]>;
  updatedAt: number;
};

const EXPIRY_MS = 1000 * 60 * 30;

function emptyRoom(): RoomPayload {
  return { peers: [], ice: {}, updatedAt: Date.now() };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
    body: JSON.stringify(body),
  };
}

function getRoomStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;

  if (siteID && token) {
    return getStore({ name: 'tempchat-rooms', siteID, token });
  }

  return getStore('tempchat-rooms');
}

export const handler: Handler = async (event) => {
  // Handle CORS preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }

  try {
    const roomId = event.queryStringParameters?.roomId;
    const peerId = event.queryStringParameters?.peerId;

    if (!roomId) {
      return json(400, { error: 'roomId is required' });
    }

    const store = getRoomStore();
    const existing = (await store.get(roomId, { type: 'json' })) as RoomPayload | null;

    let room: RoomPayload =
      existing && Date.now() - existing.updatedAt < EXPIRY_MS ? existing : emptyRoom();

    if (event.httpMethod === 'GET') {
      return json(200, room);
    }

    if (event.httpMethod === 'POST') {
      if (!peerId) return json(400, { error: 'peerId is required' });

      const body = event.body ? JSON.parse(event.body) : {};

      if (!room.peers.includes(peerId)) room.peers.push(peerId);
      if (body.offer) room.offer = body.offer;
      if (body.answer) room.answer = body.answer;
      if (body.ice) {
        room.ice[peerId] = [...(room.ice[peerId] ?? []), ...body.ice];
      }

      room.updatedAt = Date.now();
      await store.setJSON(roomId, room);
      return json(200, room);
    }

    if (event.httpMethod === 'DELETE') {
      if (peerId) {
        room.peers = room.peers.filter((p) => p !== peerId);
        delete room.ice[peerId];
        room.updatedAt = Date.now();
        await store.setJSON(roomId, room);
      } else {
        await store.delete(roomId);
      }

      return json(200, room);
    }

    return json(405, { error: 'Method not allowed' });
  } catch (error) {
    console.error('presence function error:', error);
    return json(500, {
      error: 'presence failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};