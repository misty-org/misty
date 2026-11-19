/*
 * Analyses kept on this computer, so a file is analysed once: in memory while the app runs, and
 * in IndexedDB across runs. Each is keyed by what the file holds (its size and a hash of its
 * first and last MiB), so a renamed or re-uploaded copy finds it and a changed file doesn't.
 * Both stores are bounded: the least recently used go first.
 */

/** Bumped when the analysis changes, so older results are passed by. */
const ANALYSIS_VERSION = 1;
const DATABASE = "misty-footage-analysis";
const STORE = "analyses";
/** The most analyses kept in memory, and on disk. */
const MEMORY_LIMIT = 32;
const DISK_LIMIT = 400;
const MIB = 1024 * 1024;

interface Kept {
  key: string;
  usedAt: number;
  value: unknown;
}

/** A Map that forgets its least recently used entries past its limit. */
export class RecentMap<V> {
  private readonly entries = new Map<string, V>();
  constructor(private readonly limit: number) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: V) {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

const memory = new RecentMap<{ value: unknown }>(MEMORY_LIMIT);

/** 32-bit FNV-1a, for when the system hash isn't there. */
function fnv(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

/** The key a file's analysis is kept under: the analysis version, its size and its content. */
export async function footageKey(file: Blob): Promise<string> {
  const head = new Uint8Array(await file.slice(0, MIB).arrayBuffer());
  const tail =
    file.size > MIB
      ? new Uint8Array(await file.slice(Math.max(MIB, file.size - MIB)).arrayBuffer())
      : new Uint8Array(0);
  const both = new Uint8Array(head.length + tail.length);
  both.set(head);
  both.set(tail, head.length);
  let hash: string;
  try {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", both));
    hash = Array.from(digest.subarray(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  } catch {
    hash = fnv(both);
  }
  return `v${ANALYSIS_VERSION}:${file.size}:${hash}`;
}

const settled = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The analysis store failed."));
  });

let database: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  database ??= new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("usedAt", "usedAt");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return database;
}

/** Drops the least recently used analyses past the disk limit. */
async function trim(db: IDBDatabase) {
  const count = await settled(db.transaction(STORE).objectStore(STORE).count());
  let extra = count - DISK_LIMIT;
  if (extra <= 0) return;
  const store = db.transaction(STORE, "readwrite").objectStore(STORE);
  const cursor = store.index("usedAt").openCursor();
  await new Promise<void>((resolve) => {
    cursor.onsuccess = () => {
      const at = cursor.result;
      if (!at || extra-- <= 0) return resolve();
      at.delete();
      at.continue();
    };
    cursor.onerror = () => resolve();
  });
}

/** A kept analysis, as `{ value }` (which may be null), or undefined when there is none. */
export async function readKept<T>(key: string): Promise<{ value: T } | undefined> {
  const known = memory.get(key);
  if (known) return known as { value: T };
  const db = await openDatabase();
  if (!db) return undefined;
  let kept: Kept | undefined;
  try {
    kept = (await settled(db.transaction(STORE).objectStore(STORE).get(key))) as Kept | undefined;
  } catch {
    return undefined;
  }
  if (!kept) return undefined;
  try {
    // Reading it makes it recent.
    db.transaction(STORE, "readwrite")
      .objectStore(STORE)
      .put({ ...kept, usedAt: Date.now() } satisfies Kept);
  } catch {
    // It stays as old as it was.
  }
  const found = { value: kept.value as T };
  memory.set(key, found);
  return found;
}

/** Keeps an analysis under its key. */
export async function keep(key: string, value: unknown): Promise<void> {
  memory.set(key, { value });
  const db = await openDatabase();
  if (!db) return;
  try {
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    await settled(store.put({ key, usedAt: Date.now(), value } satisfies Kept));
    await trim(db);
  } catch {
    // Not kept on disk this time; it is still in memory.
  }
}
