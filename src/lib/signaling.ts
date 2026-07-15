// Falls back to relative path (correct when served from the same Netlify origin,
// e.g. `netlify dev` or your deployed site). Override with VITE_API_BASE if
// your frontend and functions are served from different origins/ports.
const API_BASE = import.meta.env.VITE_API_BASE || '/.netlify/functions';

export type RoomPayload = {
  peers: string[];
  offer?: string;
  answer?: string;
  ice: Record<string, string[]>; // peerId to candidates that peer sent
  updatedAt: number;
};

async function call(roomId: string, method: string, peerId?: string, body?: unknown) {
  const qs = new URLSearchParams({ roomId });
  if (peerId) qs.set('peerId', peerId);
  const res = await fetch(`${API_BASE}/presence?${qs.toString()}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`presence ${method} failed`);
  return res.json() as Promise<RoomPayload>;
}

export const joinRoom = (roomId: string, peerId: string) => call(roomId, 'POST', peerId);
export const leaveRoom = (roomId: string, peerId: string) => call(roomId, 'DELETE', peerId).catch(() => {});
export const getRoom = (roomId: string) => call(roomId, 'GET');
export const postOffer = (roomId: string, peerId: string, offer: RTCSessionDescriptionInit) =>
  call(roomId, 'POST', peerId, { offer: JSON.stringify(offer) });
export const postAnswer = (roomId: string, peerId: string, answer: RTCSessionDescriptionInit) =>
  call(roomId, 'POST', peerId, { answer: JSON.stringify(answer) });
export const postIce = (roomId: string, peerId: string, candidate: RTCIceCandidateInit) =>
  call(roomId, 'POST', peerId, { ice: [JSON.stringify(candidate)] });

export async function determineRole(roomId: string, peerId: string): Promise<'offerer' | 'answerer'> {
  for (let i = 0; i < 20; i++) {
    try {
      const room = await getRoom(roomId);
      if (room.offer) return 'answerer';
      if (room.peers.length >= 2) {
        const sorted = [...room.peers].sort();
        return sorted[0] === peerId ? 'offerer' : 'answerer';
      }
    } catch {
      // presence endpoint unreachable — back off and retry rather than throwing
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return 'offerer';
}