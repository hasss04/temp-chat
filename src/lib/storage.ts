import {
  deleteRoomCipher,
  loadRoomCipher,
  saveRoomCipher,
  saveSessionState,
  loadSessionState,
  clearSessionState,
} from './db';
import { decryptJson, deriveKey, encryptJson } from './crypto';
import type { PlainMessage, ThemeMode } from '../types';

export type PersistedSession = {
  roomId: string;
  nickname: string;
  secret: string;
  activeTab: 'chat' | 'call';
  theme: ThemeMode;
  draft: string;
  lastSeenAt: number;
};

export async function persistMessages(roomId: string, secret: string, messages: PlainMessage[]) {
  const key = await deriveKey(secret);
  const cipher = await encryptJson(messages, key);
  await saveRoomCipher(roomId, cipher);
}

export async function restoreMessages(roomId: string, secret: string): Promise<PlainMessage[]> {
  const blob = await loadRoomCipher(roomId);
  if (!blob) return [];
  const key = await deriveKey(secret);
  return decryptJson<PlainMessage[]>(blob.cipherText, blob.iv, key);
}

export async function wipeRoom(roomId: string) {
  await deleteRoomCipher(roomId);
}

export async function persistSession(session: PersistedSession) {
  await saveSessionState(session);
}

export async function restoreSession(): Promise<PersistedSession | undefined> {
  return loadSessionState();
}

export async function clearPersistedSession() {
  await clearSessionState();
}
