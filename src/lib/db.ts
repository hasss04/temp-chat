import { openDB } from 'idb';
import type { EncryptedBlob } from '../types';

const dbp = openDB('tempchat-db', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('rooms')) db.createObjectStore('rooms');
  }
});

export async function saveRoomCipher(roomId: string, cipher: EncryptedBlob) {
  const db = await dbp;
  await db.put('rooms', cipher, roomId);
}

export async function loadRoomCipher(roomId: string): Promise<EncryptedBlob | undefined> {
  const db = await dbp;
  return db.get('rooms', roomId);
}

export async function deleteRoomCipher(roomId: string) {
  const db = await dbp;
  await db.delete('rooms', roomId);
}
