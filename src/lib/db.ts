import { deleteDB, openDB } from 'idb';
import type { EncryptedBlob } from '../types';
import type { PersistedSession } from './storage';

const DB_NAME = 'tempchat-db';
const DB_VERSION = 3; // bumped: added SESSIONS_STORE
const ROOM_STORE = 'rooms';
const SESSION_STORE = 'session';       // pointer: { activeRoomId }
const SESSIONS_STORE = 'sessions';     // map: roomId -> PersistedSession
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
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE);
      }
    },
    blocked() {
      console.warn('Database upgrade blocked by another open tab. Close other tabs of this app and reload.');
    },
    blocking() {
      console.warn('This tab is blocking a newer database version.');
    },
    terminated() {
      console.warn('IndexedDB connection terminated unexpectedly.');
    },
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms — likely blocked by another tab`)), ms),
    ),
  ]);
}

async function withDb<T>(work: (db: Awaited<ReturnType<typeof openTempChatDb>>) => Promise<T>): Promise<T> {
  try {
    const db = await withTimeout(openTempChatDb(), 4000, 'IndexedDB open');
    return await work(db);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('object stores was not found') ||
      message.includes('object store was not found') ||
      message.includes('One of the specified object stores was not found')
    ) {
      await deleteDB(DB_NAME).catch(() => {});
      const db = await withTimeout(openTempChatDb(), 4000, 'IndexedDB open (retry)');
      return work(db);
    }
    throw error;
  }
}

// ---- room message ciphers ----

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

// ---- active-session pointer (for auto-resume on refresh) ----

export async function saveActiveRoomPointer(roomId: string) {
  return withDb(async (db) => {
    await db.put(SESSION_STORE, roomId, SESSION_KEY);
  });
}

export async function loadActiveRoomPointer(): Promise<string | undefined> {
  return withDb(async (db) => {
    return db.get(SESSION_STORE, SESSION_KEY);
  });
}

export async function clearActiveRoomPointer() {
  return withDb(async (db) => {
    await db.delete(SESSION_STORE, SESSION_KEY);
  });
}

// ---- multi-session store (for the sessions list page) ----

export async function putSessionEntry(session: PersistedSession) {
  return withDb(async (db) => {
    await db.put(SESSIONS_STORE, session, session.roomId);
  });
}

export async function getSessionEntry(roomId: string): Promise<PersistedSession | undefined> {
  return withDb(async (db) => {
    return db.get(SESSIONS_STORE, roomId);
  });
}

export async function listSessionEntries(): Promise<PersistedSession[]> {
  return withDb(async (db) => {
    return db.getAll(SESSIONS_STORE);
  });
}

export async function deleteSessionEntry(roomId: string) {
  return withDb(async (db) => {
    await db.delete(SESSIONS_STORE, roomId);
  });
}