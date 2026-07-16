import * as Ably from 'ably';

const API_BASE = import.meta.env.VITE_API_BASE || '/.netlify/functions';

let client: Ably.Realtime | null = null;
let clientPeerId: string | null = null;
let authInFlight: Promise<void> | null = null;

// Must live under the 'tempchat:' namespace to match the token capability
// 'tempchat:*' (colon = Ably namespace wildcard). A hyphen prefix does NOT
// work as a wildcard in Ably capabilities.
function roomChannelName(roomId: string) {
  return `tempchat:room-${roomId}`;
}

export type RoomEvent =
  | { type: 'presence-updated' }
  | { type: 'signal-updated'; fromPeerId: string };

async function fetchTokenRequest(peerId: string) {
  const res = await fetch(`${API_BASE}/ably-token?peerId=${encodeURIComponent(peerId)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`ably token fetch failed: ${res.status}`);
  }
  return res.json();
}

async function authorizeClient(realtime: Ably.Realtime, peerId: string) {
  if (authInFlight) {
    await authInFlight;
    return;
  }
  authInFlight = (async () => {
    try {
      const tokenRequest = await fetchTokenRequest(peerId);
      await realtime.auth.authorize(undefined, {
        authCallback: (_params, callback) => callback(null, tokenRequest),
      });
    } finally {
      authInFlight = null;
    }
  })();
  await authInFlight;
}

export function initRealtime(peerId: string): Ably.Realtime {
  if (client && clientPeerId === peerId) {
    return client;
  }
  client?.close();
  clientPeerId = peerId;
  client = new Ably.Realtime({
    autoConnect: true,
    authCallback: async (_params, callback) => {
      try {
        const tokenRequest = await fetchTokenRequest(peerId);
        callback(null, tokenRequest);
      } catch (err) {
        console.error('[realtime] token fetch failed', err);
        callback(err instanceof Error ? err.message : String(err), null);
      }
    },
  });
  client.connection.on((stateChange) => {
    console.log('[realtime] connection', stateChange.current);
  });
  void authorizeClient(client, peerId).catch((err) => {
    console.error('[realtime] initial authorize failed', err);
  });
  return client;
}

export async function reauthorizeRealtime() {
  if (!client || !clientPeerId) return;
  await authorizeClient(client, clientPeerId);
}

export function closeRealtimeClient() {
  client?.close();
  client = null;
  clientPeerId = null;
  authInFlight = null;
}

export function subscribeRoomEvents(
  roomId: string,
  onEvent: (event: RoomEvent) => void,
): () => void {
  if (!client) {
    console.warn('subscribeRoomEvents called before initRealtime');
    return () => {};
  }
  const channel = client.channels.get(roomChannelName(roomId));
  const handler = (msg: Ably.Message) => {
    if (msg.data && typeof msg.data === 'object') {
      onEvent(msg.data as RoomEvent);
    }
  };
  channel.subscribe('room-event', handler);
  return () => {
    channel.unsubscribe('room-event', handler);
  };
}

/**
 * Fire-and-forget wake ping. Deliberately swallows all errors — this is a
 * best-effort optimization layered on top of the slow safety-net poll in
 * SignalBridge, never something callers should need to await or catch.
 * In particular this must NOT throw during teardown (killSwitch/leaveRoomOnly
 * closing the Ably connection right after a leaveRoom() call) — an unawaited
 * throwing promise there becomes an uncaught rejection.
 */
export function publishRoomWake(roomId: string, fromPeerId?: string): void {
  if (!client || client.connection.state === 'closed' || client.connection.state === 'closing') {
    return;
  }
  const channel = client.channels.get(roomChannelName(roomId));
  channel
    .publish('room-event', {
      type: 'signal-updated',
      fromPeerId: fromPeerId ?? clientPeerId ?? 'unknown',
    } satisfies RoomEvent)
    .catch((error) => {
      // Best-effort only — never let this become an unhandled rejection.
      console.warn('[realtime] publishRoomWake failed (non-fatal)', error);
    });
}

export function getRealtimeConnectionState(): Ably.ConnectionState | 'uninitialized' {
  return client?.connection.state ?? 'uninitialized';
}