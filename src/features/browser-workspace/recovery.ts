import { invoke } from "@tauri-apps/api/core";
import type { JournalStorage } from "./editJournal";

interface RecordValue {
  revision: number;
  value: string;
}
export interface RecoveryPort {
  read(key: string): Promise<RecordValue | null>;
  write(key: string, revision: number, value: string): Promise<RecordValue>;
}

/** In-memory view of native encrypted storage. Mutations are pending until flush
 * completes. A failed/lost reply retains the exact attempted write for retry. */
export class NativeRecoveryStorage implements JournalStorage {
  private values = new Map<string, string>();
  private saved = new Map<string, RecordValue>();
  private dirty = new Set<string>();
  private attempt?: { key: string; revision: number; value: string };
  private running?: Promise<void>;
  constructor(private port: RecoveryPort) {}
  async load(key: string): Promise<void> {
    if (this.values.has(key)) return;
    const record = await this.port.read(key);
    if (this.dirty.has(key)) throw new Error("Workspace recovery changed while loading");
    if (record) {
      this.saved.set(key, record);
      this.values.set(key, record.value);
    }
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.values.get(key) === value) return;
    this.values.set(key, value);
    this.dirty.add(key);
  }
  async flush(): Promise<void> {
    while (this.running || this.attempt || this.dirty.size) {
      this.running ??= this.drain().finally(() => {
        this.running = undefined;
      });
      await this.running;
    }
  }
  private async drain(): Promise<void> {
    while (this.attempt || this.dirty.size) {
      const key = this.attempt?.key ?? this.dirty.values().next().value!;
      this.attempt ??= {
        key,
        revision: this.saved.get(key)?.revision ?? 0,
        value: this.values.get(key)!,
      };
      const attempt = this.attempt;
      const record = await this.port.write(key, attempt.revision, attempt.value);
      if (record.value !== attempt.value || record.revision < attempt.revision)
        throw new Error("Native workspace recovery returned a different save");
      this.saved.set(key, record);
      this.attempt = undefined;
      if (this.values.get(key) === record.value) this.dirty.delete(key);
    }
  }
}

const active = new Set<NativeRecoveryStorage>();
const beforeFlush = new Set<() => Promise<void>>();
export function registerRecoveryFlush(callback: () => Promise<void>): () => void {
  beforeFlush.add(callback);
  return () => {
    beforeFlush.delete(callback);
  };
}
export async function flushWorkspaceRecovery(): Promise<void> {
  await Promise.all([...beforeFlush].map((flush) => flush()));
  await Promise.all([...active].map((storage) => storage.flush()));
}
export async function openWorkspaceRecovery(apiBase: string, accountId: string) {
  const { session_id: sessionId } = await invoke<{ session_id: string }>("browser_recovery_open", {
    apiBase,
    accountId,
  });
  const storage = new NativeRecoveryStorage({
    read: (key) => invoke("browser_recovery_read", { sessionId, key }),
    write: (key, revision, value) =>
      invoke("browser_recovery_write", { sessionId, key, revision, value }),
  });
  active.add(storage);
  return { storage, release: () => active.delete(storage) };
}

export async function recoveryKey(kind: string, identity: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(identity));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `${kind}:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Delete only the exact legacy value whose native copy was acknowledged.
 * A concurrent modification remains available for a subsequent migration. */
export async function migrateRecoveryRecord(
  storage: NativeRecoveryStorage,
  key: string,
  legacy: Pick<Storage, "getItem" | "removeItem">,
  legacyKey: string,
  archiveOnlyConflict = false,
) {
  await storage.load(key);
  const raw = legacy.getItem(legacyKey);
  if (raw === null) return;
  const archive = await recoveryKey("archive", [legacyKey, raw]);
  await storage.load(archive);
  storage.setItem(archive, raw);
  const existing = storage.getItem(key);
  if (storage.getItem(key) === null) storage.setItem(key, raw);
  await storage.flush();
  if (existing !== null && existing !== raw && !archiveOnlyConflict)
    throw new Error("The browser and native recovery copies differ. Both have been preserved.");
  if (legacy.getItem(legacyKey) === raw) legacy.removeItem(legacyKey);
}
