import { deleteDB, openDB } from 'idb';
import type { EncryptedBlob } from '../types';
import type { PersistedSession } from './storage';

const DB_NAME = 'tempchat-db';
const DB_VERSION = 2;

const ROOM_STORE = 'rooms';
const SESSION_STORE = 'session';
const SESSION_KEY = 'active-session';

async function openTempChatDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(ROOM_STORE)) {
        db.createObjectStore(ROOM_STORE);
      }

      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE);
      }
    },
    blocked() {
      console.warn('Database upgrade blocked by another open tab.');
    },
    blocking() {
      console.warn('This tab is blocking a newer database version.');
    },
    terminated() {
      console.warn('IndexedDB connection terminated unexpectedly.');
    },
  });
}

async function withDb<T>(work: (db: Awaited<ReturnType<typeof openTempChatDb>>) => Promise<T>): Promise<T> {
  try {
    const db = await openTempChatDb();
    return await work(db);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (
      message.includes('object stores was not found') ||
      message.includes('object store was not found') ||
      message.includes('One of the specified object stores was not found')
    ) {
      await deleteDB(DB_NAME).catch(() => {});
      const db = await openTempChatDb();
      return work(db);
    }

    throw error;
  }
}

export async function saveRoomCipher(roomId: string, cipher: EncryptedBlob) {
  return withDb(async (db) => {
    await db.put(ROOM_STORE, cipher, roomId);
  });
}

export async function loadRoomCipher(roomId: string): Promise<EncryptedBlob | undefined> {
  return withDb(async (db) => {
    return db.get(ROOM_STORE, roomId);
  });
}

export async function deleteRoomCipher(roomId: string) {
  return withDb(async (db) => {
    await db.delete(ROOM_STORE, roomId);
  });
}

export async function saveSessionState(session: PersistedSession) {
  return withDb(async (db) => {
    await db.put(SESSION_STORE, session, SESSION_KEY);
  });
}

export async function loadSessionState(): Promise<PersistedSession | undefined> {
  return withDb(async (db) => {
    return db.get(SESSION_STORE, SESSION_KEY);
  });
}

export async function clearSessionState() {
  return withDb(async (db) => {
    await db.delete(SESSION_STORE, SESSION_KEY);
  });
}