/**
 * Résumé and cover-letter files kept on disk between runs, by account and address,
 * each with the version tag (ETag) the API gave it. Every use asks the API whether
 * that version is still current: an unchanged file comes back as a bodiless 304,
 * a changed one replaces the copy. Files live in the extension's own IndexedDB
 * (unlimited storage), never in the service worker's memory, and the store keeps
 * under a size cap by dropping the copies used longest ago.
 */

import { getAcornSession } from "../../auth/acorn-auth";

const DB_NAME = "acorn-file-cache";
const DB_VERSION = 1;
const FILE_STORE = "files";
/** The most the stored files may take, as stored text; the oldest-used go first. */
const FILE_CACHE_MAX_CHARS = 200 * 1024 * 1024;
/** The most a read of the stored copy may take: a stuck database is skipped, not waited on. */
const FILE_CACHE_READ_TIMEOUT_MS = 3_000;
/** The most one file request may take, so a stalled link ends the step with a reason. */
const FILE_FETCH_TIMEOUT_MS = 90_000;

interface StoredFile {
  key: string;
  etag: string;
  data: unknown;
  chars: number;
  usedAt: number;
}

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(FILE_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = null;
      reject(request.error ?? new Error("Could not open the file cache"));
    };
  });
  return database;
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error("File cache write failed"));
  });
}

async function readStored(key: string): Promise<StoredFile | null> {
  const db = await openDatabase();
  const read = db.transaction(FILE_STORE, "readonly");
  const request = read.objectStore(FILE_STORE).get(key);
  await done(read);
  return (request.result as StoredFile | undefined) ?? null;
}

async function writeStored(file: StoredFile): Promise<void> {
  const db = await openDatabase();
  const write = db.transaction(FILE_STORE, "readwrite");
  write.objectStore(FILE_STORE).put(file);
  await done(write);
  await keepUnderCap();
}

/** Drop the copies used longest ago until the store fits its cap. */
async function keepUnderCap(): Promise<void> {
  const db = await openDatabase();
  const write = db.transaction(FILE_STORE, "readwrite");
  const store = write.objectStore(FILE_STORE);
  const all = store.getAll();
  all.onsuccess = () => {
    const files = (all.result as StoredFile[]).sort((a, b) => a.usedAt - b.usedAt);
    let total = files.reduce((sum, file) => sum + file.chars, 0);
    for (const file of files) {
      if (total <= FILE_CACHE_MAX_CHARS) break;
      store.delete(file.key);
      total -= file.chars;
    }
  };
  await done(write);
}

async function touch(file: StoredFile): Promise<void> {
  const db = await openDatabase();
  const write = db.transaction(FILE_STORE, "readwrite");
  write.objectStore(FILE_STORE).put({ ...file, usedAt: Date.now() });
  await done(write);
}

/** A file response: the status as the API means it, and its parsed JSON. */
export interface CachedResponse<T> {
  ok: boolean;
  status: number;
  data: T;
}

/**
 * GET one file's JSON through the cache. The stored copy is used when the API says
 * it is still current (304); otherwise the answer is used and, when the API tagged
 * it, stored. Any cache trouble falls back to a plain request.
 */
export async function cachedFileGet<T>(
  url: string,
  headers: Record<string, string>,
): Promise<CachedResponse<T>> {
  const account = (await getAcornSession().catch(() => null))?.username ?? "";
  const key = `${account}|${url}`;
  const stored = await Promise.race([
    readStored(key).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), FILE_CACHE_READ_TIMEOUT_MS)),
  ]);
  const res = await fetch(url, {
    headers: stored ? { ...headers, "If-None-Match": stored.etag } : headers,
    signal: AbortSignal.timeout(FILE_FETCH_TIMEOUT_MS),
  });
  if (res.status === 304 && stored) {
    void touch(stored).catch(() => undefined);
    return { ok: true, status: 200, data: stored.data as T };
  }
  const data = (await res.json().catch(() => ({}))) as T;
  const etag = res.headers.get("ETag");
  if (res.ok && etag) {
    const chars = JSON.stringify(data).length;
    // Kept in the background: the file is the caller's now, whatever the store does.
    void writeStored({ key, etag, data, chars, usedAt: Date.now() }).catch(() => undefined);
  }
  return { ok: res.ok, status: res.status, data };
}
