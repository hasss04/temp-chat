import {
  deleteRoomCipher,
  loadRoomCipher,
  saveRoomCipher,
  saveActiveRoomPointer,
  loadActiveRoomPointer,
  clearActiveRoomPointer,
  putSessionEntry,
  getSessionEntry,
  listSessionEntries,
  deleteSessionEntry,
} from './db';
import { decryptJson, deriveKey, encryptJson } from './crypto';
import type { PlainMessage, ThemeMode } from '../types';

export type PersistedSession = {
  roomId: string;
  peerId: string;
  nickname: string;
  secret: string;
  activeTab: 'chat' | 'call';
  theme: ThemeMode;
  draft: string;
  lastSeenAt: number;
};

function isValidRoomKey(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function persistMessages(roomId: string, secret: string, messages: PlainMessage[]) {
  const key = await deriveKey(secret);
  const cipher = await encryptJson(messages, key);
  await saveRoomCipher(roomId, cipher);
}

export async function restoreMessages(roomId: string, secret: string): Promise<PlainMessage[]> {
  if (!isValidRoomKey(roomId) || !secret?.trim()) return [];
  const blob = await loadRoomCipher(roomId);
  if (!blob) return [];
  const key = await deriveKey(secret);
  return decryptJson<PlainMessage[]>(blob.cipherText, blob.iv, key);
}

export async function wipeRoom(roomId: string) {
  if (!isValidRoomKey(roomId)) return;
  await deleteRoomCipher(roomId).catch(() => {});
  await deleteSessionEntry(roomId).catch(() => {});
  const activeRoomId = await loadActiveRoomPointer().catch(() => undefined);
  if (activeRoomId === roomId) {
    await clearActiveRoomPointer().catch(() => {});
  }
}

export async function persistSession(session: PersistedSession) {
  if (!isValidRoomKey(session.roomId)) return;
  await putSessionEntry({
    ...session,
    roomId: session.roomId.trim(),
    peerId: session.peerId?.trim() || crypto.randomUUID(),
    nickname: session.nickname?.trim() || 'Anon',
    secret: session.secret?.trim() || '',
    draft: session.draft ?? '',
    activeTab: session.activeTab ?? 'chat',
    lastSeenAt: session.lastSeenAt ?? Date.now(),
  });
  await saveActiveRoomPointer(session.roomId.trim());
}

export async function restoreActiveSession(): Promise<PersistedSession | undefined> {
  try {
    const roomId = await loadActiveRoomPointer();

    if (!isValidRoomKey(roomId)) {
      await clearActiveRoomPointer().catch(() => {});
      return undefined;
    }

    const session = await getSessionEntry(roomId.trim());

    if (!session || !isValidRoomKey(session.roomId) || !session.secret?.trim()) {
      return undefined;
    }

    return {
      ...session,
      roomId: session.roomId.trim(),
      peerId: session.peerId?.trim() || crypto.randomUUID(),
      nickname: session.nickname?.trim() || 'Anon',
      activeTab: session.activeTab ?? 'chat',
      draft: session.draft ?? '',
      lastSeenAt: session.lastSeenAt ?? Date.now(),
    };
  } catch (error) {
    console.error('restoreActiveSession failed', error);
    await clearActiveRoomPointer().catch(() => {});
    return undefined;
  }
}

export async function clearActivePointer() {
  await clearActiveRoomPointer();
}

export async function forgetSession(roomId: string) {
  if (!isValidRoomKey(roomId)) return;
  await deleteSessionEntry(roomId);
  const activeRoomId = await loadActiveRoomPointer().catch(() => undefined);
  if (activeRoomId === roomId) {
    await clearActiveRoomPointer();
  }
}

export async function clearPersistedSession(roomId?: string) {
  if (isValidRoomKey(roomId)) {
    await forgetSession(roomId);
    return;
  }
  await clearActivePointer();
}

export async function listSessions(): Promise<PersistedSession[]> {
  const sessions = await listSessionEntries().catch(() => []);
  return sessions
    .filter((session) => isValidRoomKey(session?.roomId))
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}