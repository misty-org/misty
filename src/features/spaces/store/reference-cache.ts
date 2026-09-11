const cacheDatabaseName = "misty-space-reference-cache-v1";
const cacheStoreName = "entries";
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
