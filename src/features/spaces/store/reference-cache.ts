import type { UnifiedNote } from "@/features/journal/notes";
import type {
  LibraryItemsResult,
  SpaceMember,
  SpaceMessage,
  SpaceNode,
  SpaceTaskPage,
  SpacesSnapshot,
} from "@/api/spaces/dto/interfaces/types";
const cacheDatabaseName = "misty-space-reference-cache-v1";
const cacheStoreName = "entries";

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

export async function removeSpaceReferenceCache(accountId: string): Promise<void> {
  const normalized = accountId.trim();
  if (!normalized) return;
  try {
    await deleteEncryptedCache(normalized);
  } catch {
    /* reference storage is best-effort */
  }
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
