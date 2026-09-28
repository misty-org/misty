import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";
export interface StoredState<T> {
  revision: number;
  state: T | null;
}
let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("misty-settings-profiles", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        database = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      database = undefined;
      reject(new Error("Close other Misty tabs to upgrade settings storage."));
    };
  });
  return database;
}
export async function readState<T>(scope: string): Promise<StoredState<T>> {
  if (hasTauriInternals()) return invoke("settings_profile_state", { scope });
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("state", "readonly");
    const request = transaction.objectStore("state").get(scope);
    transaction.oncomplete = () => resolve(request.result ?? { revision: 0, state: null });
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Settings read interrupted"));
  });
}
async function commitState<T>(scope: string, revision: number, state: T): Promise<void> {
  if (hasTauriInternals()) {
    await invoke("settings_profile_commit", { scope, revision, document: state });
    return;
  }
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite", { durability: "strict" });
    const store = tx.objectStore("state");
    const get = store.get(scope);
    let conflict = false;
    get.onsuccess = () => {
      if ((get.result?.revision ?? 0) !== revision) {
        conflict = true;
        tx.abort();
        return;
      }
      store.put({ revision: revision + 1, state }, scope);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(
        new Error(
          conflict
            ? "SETTINGS_REVISION_CONFLICT"
            : (tx.error?.message ?? "Settings write interrupted"),
        ),
      );
  });
}
export async function mutateState<T>(
  scope: string,
  seed: () => T,
  reducer: (state: T) => T,
): Promise<T> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const current = await readState<T>(scope);
    const next = reducer(current.state ?? seed());
    try {
      await commitState(scope, current.revision, next);
      return next;
    } catch (error) {
      if (!String(error).includes("SETTINGS_REVISION_CONFLICT")) throw error;
    }
  }
  throw new Error("Settings changed in another window. Try again.");
}
