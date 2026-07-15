import { deleteRoomCipher, loadRoomCipher, saveRoomCipher } from './db';
import { decryptJson, deriveKey, encryptJson } from './crypto';
import type { PlainMessage } from '../types';

export async function persistMessages(roomId: string, secret: string, messages: PlainMessage[]) {
  const key = await deriveKey(secret);
  const cipher = await encryptJson(messages, key);
  await saveRoomCipher(roomId, cipher);
}

export async function restoreMessages(roomId: string, secret: string) {
  const blob = await loadRoomCipher(roomId);
  if (!blob) return [] as PlainMessage[];
  const key = await deriveKey(secret);
  return decryptJson<PlainMessage[]>(blob.cipherText, blob.iv, key);
}

export async function wipeRoom(roomId: string) {
  await deleteRoomCipher(roomId);
}
