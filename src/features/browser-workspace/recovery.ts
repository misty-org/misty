import { invoke } from "@tauri-apps/api/core";
import type { JournalStorage } from "./editJournal";

interface RecordValue {
  revision: number;
  value: string;
  /** Held in the native encrypted pending slot until the database accepts it. */
  pending?: boolean;
}
export interface RecoveryPort {
  read(key: string): Promise<RecordValue | null>;
  write(key: string, revision: number, value: string): Promise<RecordValue>;
}
/** Where each key's newest value stands: in the database, waiting in its
 * encrypted pending slot, or refused (kept in memory until it changes). */
export interface RecoverySaveStatus {
  pending: string[];
  failed: { key: string; error: string }[];
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** In-memory view of native encrypted storage. Each key holds only its newest
 * value, so a failed save is replaced by the next one rather than queued
 * behind it. Saves are idempotent: a stale revision (for example after a lost
 * reply) is resolved by reading what native already holds. */
export class NativeRecoveryStorage implements JournalStorage {
  private values = new Map<string, string>();
  private saved = new Map<string, RecordValue>();
  private dirty = new Set<string>();
  private pending = new Set<string>();
  /** The exact value native refused per key; retried once it changes or on `retry`. */
  private failed = new Map<string, { value: string; error: string }>();
  private running?: Promise<void>;
  constructor(
    private port: RecoveryPort,
    private changed: (status: RecoverySaveStatus) => void = () => undefined,
  ) {}
  async load(key: string): Promise<void> {
    if (this.values.has(key)) return;
    const record = await this.port.read(key);
    if (this.dirty.has(key)) throw new Error("Workspace recovery changed while loading");
    if (record) {
      this.saved.set(key, record);
      this.values.set(key, record.value);
      if (record.pending) this.markPending(key, true);
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
  /** Keys native reports waiting in pending slots from an earlier session. */
  notePending(keys: string[]) {
    for (const key of keys) this.markPending(key, true);
    this.changed(this.status());
  }
  status(): RecoverySaveStatus {
    return {
      pending: [...this.pending].sort(),
      failed: [...this.failed].map(([key, { error }]) => ({ key, error })),
    };
  }
  /** Saves every changed key. Keys native refuses stay listed in `status` and
   * do not block the others; the flush rejects so callers keep their sources. */
  async flush(): Promise<void> {
    while (this.running || this.waiting().length) {
      this.running ??= this.drain().finally(() => {
        this.running = undefined;
      });
      await this.running;
    }
    if (this.failed.size)
      throw new Error(
        `${this.failed.size} workspace save${this.failed.size === 1 ? "" : "s"} could not be stored`,
      );
  }
  /** Tries refused saves again. */
  async retry(): Promise<void> {
    this.failed.clear();
    this.changed(this.status());
    await this.flush();
  }
  private waiting(): string[] {
    return [...this.dirty].filter((key) => this.failed.get(key)?.value !== this.values.get(key));
  }
  private async drain(): Promise<void> {
    for (const key of this.waiting()) {
      const value = this.values.get(key)!;
      try {
        this.accept(key, value, await this.save(key, value));
      } catch (error) {
        this.failed.set(key, { value, error: message(error) });
      }
    }
    this.changed(this.status());
  }
  private async save(key: string, value: string): Promise<RecordValue> {
    try {
      return await this.port.write(key, this.saved.get(key)?.revision ?? 0, value);
    } catch (error) {
      // Native may already hold this value (a lost reply) or a newer revision
      // from this device; learn which instead of repeating a stale write.
      const current = await this.port.read(key).catch(() => undefined);
      if (current === undefined) throw error;
      if (current?.value === value) return current;
      const base = current?.revision ?? 0;
      if (base === (this.saved.get(key)?.revision ?? 0)) throw error;
      if (current) this.saved.set(key, current);
      return this.port.write(key, base, value);
    }
  }
  private accept(key: string, value: string, record: RecordValue) {
    if (record.value !== value || record.revision < (this.saved.get(key)?.revision ?? 0))
      throw new Error("Native workspace recovery returned a different save");
    this.saved.set(key, record);
    this.failed.delete(key);
    this.markPending(key, Boolean(record.pending));
    if (this.values.get(key) === record.value) this.dirty.delete(key);
  }
  private markPending(key: string, pending: boolean) {
    if (pending) this.pending.add(key);
    else this.pending.delete(key);
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
export async function openWorkspaceRecovery(
  apiBase: string,
  accountId: string,
  changed?: (status: RecoverySaveStatus) => void,
) {
  const { session_id: sessionId, pending = [] } = await invoke<{
    session_id: string;
    pending?: string[];
  }>("browser_recovery_open", {
    apiBase,
    accountId,
  });
  const storage = new NativeRecoveryStorage(
    {
      read: (key) => invoke("browser_recovery_read", { sessionId, key }),
      write: (key, revision, value) =>
        invoke("browser_recovery_write", { sessionId, key, revision, value }),
    },
    changed,
  );
  active.add(storage);
  storage.notePending(pending);
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
  // A migration attempt is explicit: retry saves an earlier attempt left refused.
  await storage.retry();
  if (existing !== null && existing !== raw && !archiveOnlyConflict)
    throw new Error("The browser and native recovery copies differ. Both have been preserved.");
  if (legacy.getItem(legacyKey) === raw) legacy.removeItem(legacyKey);
}
