import type { UnifiedNote } from "@/features/notes";
import type {
  LibraryItemsResult,
  SpaceMember,
  SpaceMessage,
  SpaceNode,
  SpaceTaskPage,
  SpacesSnapshot,
} from "@/api/spaces/dto/interfaces/types";
import { readApiAuthToken } from "@/api/client/session";

const cacheVersion = 1;
const cacheDatabaseName = "misty-space-reference-cache-v1";
const cacheStoreName = "entries";
const cacheMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface SpaceReferenceCache {
  version: 1;
  accountId: string;
  savedAt: string;
  snapshot: Pick<SpacesSnapshot, "spaces" | "entitlements" | "owner_storage">;
  membersBySpace: Record<string, SpaceMember[]>;
  messagesBySpace: Record<string, SpaceMessage[]>;
  nodesBySpace: Record<string, SpaceNode[]>;
  tasksBySpace: Record<string, SpaceTaskPage>;
  notesBySpace: Record<string, UnifiedNote[]>;
  libraryQueriesBySpace: Record<string, Record<string, LibraryItemsResult>>;
}

type EncryptedCache = {
  version: 1;
  accountId: string;
  iv: string;
  ciphertext: string;
};

let activeAccountId = "";
const memory = new Map<string, SpaceReferenceCache>();
let writeQueue = Promise.resolve();

export function setSpaceReferenceAccount(accountId: string): void {
  activeAccountId = accountId.trim();
}

export function currentSpaceReferenceAccount(): string {
  return activeAccountId;
}

export async function readSpaceReferenceCache(): Promise<SpaceReferenceCache | null> {
  const accountId = activeAccountId;
  if (!accountId) return null;
  const cached = memory.get(accountId);
  if (cached) {
    if (cacheIsFresh(cached)) return cached;
    memory.delete(accountId);
    void deleteEncryptedCache(accountId);
    return null;
  }
  try {
    const encrypted = await readEncryptedCache(accountId);
    if (!encrypted) return null;
    if (encrypted.version !== cacheVersion) return null;
    const key = await cacheEncryptionKey(accountId);
    if (!key) return null;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(encrypted.iv) },
      key,
      fromBase64(encrypted.ciphertext),
    );
    const value = JSON.parse(decoder.decode(plaintext)) as SpaceReferenceCache;
    if (value.version !== cacheVersion || value.accountId !== accountId || !cacheIsFresh(value)) {
      await deleteEncryptedCache(accountId);
      return null;
    }
    memory.set(accountId, value);
    return value;
  } catch {
    return null;
  }
}

export function cacheSpaceSnapshot(snapshot: SpacesSnapshot): void {
  void updateCache((current, accountId) => {
    const next = current ?? emptyCache(accountId, snapshot);
    const accessible = new Set(snapshot.spaces.map((space) => space.id));
    const readableMessages = new Set(
      snapshot.spaces
        .filter((space) => space.permissions?.["messages.read"] !== false)
        .map((space) => space.id),
    );
    const readableTasks = new Set(
      snapshot.spaces
        .filter((space) => space.permissions?.["tasks.view"] !== false)
        .map((space) => space.id),
    );
    const readableLibrary = new Set(
      snapshot.spaces
        .filter((space) => space.permissions?.["library.view"] !== false)
        .map((space) => space.id),
    );
    return {
      ...next,
      savedAt: new Date().toISOString(),
      snapshot: {
        spaces: snapshot.spaces,
        entitlements: snapshot.entitlements,
        owner_storage: snapshot.owner_storage,
      },
      membersBySpace: retainSpaceRecords(next.membersBySpace, accessible),
      messagesBySpace: retainSpaceRecords(next.messagesBySpace, readableMessages),
      nodesBySpace: retainSpaceRecords(next.nodesBySpace, readableMessages),
      tasksBySpace: retainSpaceRecords(next.tasksBySpace, readableTasks),
      notesBySpace: retainSpaceRecords(next.notesBySpace ?? {}, accessible),
      libraryQueriesBySpace: retainSpaceRecords(next.libraryQueriesBySpace ?? {}, readableLibrary),
    };
  });
}

export function cacheSpaceMembers(spaceId: string, members: SpaceMember[]): void {
  void updateCache((current) =>
    current
      ? {
          ...current,
          membersBySpace: { ...current.membersBySpace, [spaceId]: members.slice(0, 250) },
        }
      : null,
  );
}

export function cacheSpaceMessages(spaceId: string, messages: SpaceMessage[]): void {
  void updateCache((current) =>
    current
      ? {
          ...current,
          messagesBySpace: { ...current.messagesBySpace, [spaceId]: messages.slice(-50) },
        }
      : null,
  );
}

export function cacheSpaceNodes(spaceId: string, nodes: SpaceNode[]): void {
  void updateCache((current) =>
    current
      ? { ...current, nodesBySpace: { ...current.nodesBySpace, [spaceId]: nodes.slice(0, 250) } }
      : null,
  );
}

export function cacheSpaceTasks(spaceId: string, page: SpaceTaskPage): void {
  void updateCache((current) =>
    current
      ? {
          ...current,
          tasksBySpace: {
            ...current.tasksBySpace,
            [spaceId]: mergeTaskPages(current.tasksBySpace?.[spaceId], page),
          },
        }
      : null,
  );
}

export function cacheSpaceNotes(spaceId: string, notes: UnifiedNote[]): void {
  void updateCache((current) =>
    current
      ? { ...current, notesBySpace: { ...(current.notesBySpace ?? {}), [spaceId]: notes } }
      : null,
  );
}

export function cacheSpaceLibraryQuery(
  spaceId: string,
  queryKey: string,
  result: LibraryItemsResult,
): void {
  void updateCache((current) => {
    if (!current) return null;
    const queries = {
      ...(current.libraryQueriesBySpace?.[spaceId] ?? {}),
      [queryKey]: { ...result, items: result.items.slice(0, 200), next_after: undefined },
    };
    const retained = Object.fromEntries(Object.entries(queries).slice(-12));
    return {
      ...current,
      libraryQueriesBySpace: {
        ...(current.libraryQueriesBySpace ?? {}),
        [spaceId]: retained,
      },
    };
  });
}

export async function removeSpaceReferenceCache(accountId: string): Promise<void> {
  const normalized = accountId.trim();
  if (!normalized) return;
  memory.delete(normalized);
  try {
    await deleteEncryptedCache(normalized);
  } catch {
    /* reference storage is best-effort */
  }
}

function updateCache(
  mutate: (current: SpaceReferenceCache | null, accountId: string) => SpaceReferenceCache | null,
): Promise<void> {
  const accountId = activeAccountId;
  if (!accountId) return Promise.resolve();
  writeQueue = writeQueue.then(async () => {
    if (accountId !== activeAccountId) return;
    const current = memory.get(accountId) ?? (await readSpaceReferenceCache());
    const next = mutate(current, accountId);
    if (!next) return;
    memory.set(accountId, next);
    await persistCache(next);
  });
  return writeQueue;
}

async function persistCache(value: SpaceReferenceCache): Promise<void> {
  try {
    const key = await cacheEncryptionKey(value.accountId);
    if (!key) return;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(JSON.stringify(value)),
    );
    const encrypted: EncryptedCache = {
      version: cacheVersion,
      accountId: value.accountId,
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(ciphertext)),
    };
    await writeEncryptedCache(encrypted);
  } catch {
    /* a full or unavailable cache must never interrupt live Space work */
  }
}

async function cacheEncryptionKey(accountId: string): Promise<CryptoKey | null> {
  const token = await readApiAuthToken();
  if (!token) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`misty-space-reference-cache-v1\0${accountId}\0${token}`),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function emptyCache(accountId: string, snapshot: SpacesSnapshot): SpaceReferenceCache {
  return {
    version: cacheVersion,
    accountId,
    savedAt: new Date().toISOString(),
    snapshot: {
      spaces: snapshot.spaces,
      entitlements: snapshot.entitlements,
      owner_storage: snapshot.owner_storage,
    },
    membersBySpace: {},
    messagesBySpace: {},
    nodesBySpace: {},
    tasksBySpace: {},
    notesBySpace: {},
    libraryQueriesBySpace: {},
  };
}

function mergeTaskPages(current: SpaceTaskPage | undefined, next: SpaceTaskPage): SpaceTaskPage {
  const tasks = new Map((current?.tasks ?? []).map((task) => [task.id, task]));
  next.tasks.forEach((task) => tasks.set(task.id, task));
  return {
    tasks: [...tasks.values()]
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, 500),
    status_totals: next.status_totals,
  };
}

function retainSpaceRecords<T>(
  records: Record<string, T>,
  allowed: Set<string>,
): Record<string, T> {
  return Object.fromEntries(Object.entries(records).filter(([spaceId]) => allowed.has(spaceId)));
}

function cacheIsFresh(value: SpaceReferenceCache): boolean {
  const savedAt = new Date(value.savedAt).getTime();
  return Number.isFinite(savedAt) && Date.now() - savedAt <= cacheMaxAgeMs;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function readEncryptedCache(accountId: string): Promise<EncryptedCache | null> {
  const database = await openCacheDatabase();
  if (!database) return null;
  return new Promise((resolve) => {
    const request = database
      .transaction(cacheStoreName, "readonly")
      .objectStore(cacheStoreName)
      .get(accountId);
    request.onsuccess = () => {
      const result = (request.result as EncryptedCache | undefined) ?? null;
      database.close();
      resolve(result);
    };
    request.onerror = () => {
      database.close();
      resolve(null);
    };
  });
}

async function writeEncryptedCache(value: EncryptedCache): Promise<void> {
  const database = await openCacheDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const request = database
      .transaction(cacheStoreName, "readwrite")
      .objectStore(cacheStoreName)
      .put(value);
    request.onsuccess = () => {
      database.close();
      resolve();
    };
    request.onerror = () => {
      database.close();
      resolve();
    };
  });
}

async function deleteEncryptedCache(accountId: string): Promise<void> {
  const database = await openCacheDatabase();
  if (!database) return;
  await new Promise<void>((resolve) => {
    const request = database
      .transaction(cacheStoreName, "readwrite")
      .objectStore(cacheStoreName)
      .delete(accountId);
    request.onsuccess = () => {
      database.close();
      resolve();
    };
    request.onerror = () => {
      database.close();
      resolve();
    };
  });
}

function openCacheDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(cacheDatabaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(cacheStoreName))
        database.createObjectStore(cacheStoreName, { keyPath: "accountId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}
