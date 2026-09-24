import type { Resume, WorkspaceChange } from "./model";

export interface PendingEdit {
  id: string;
  changes: WorkspaceChange[];
  resume?: Resume;
  activeEpoch?: string;
}
export interface JournalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  flush?(): Promise<void>;
}
/** Renderer crash recovery for workspace edits only. Website credential payloads
 * and unlock secrets never enter this journal. Native receipts deduplicate a
 * retry even if native accepted the edit before the renderer crashed. */
export class EditJournal {
  private edits: PendingEdit[];
  private readonly key: string;
  constructor(
    private readonly storage: JournalStorage,
    identity: { deployment: string; account_id: string; workspace_id: string; device_id: string },
    nativeKey?: string,
  ) {
    this.key = nativeKey ?? editJournalKey(identity);
    const encoded = storage.getItem(this.key);
    const saved = encoded ? JSON.parse(encoded) : { version: 1, edits: [] };
    if (
      saved.version !== 1 ||
      !Array.isArray(saved.edits) ||
      saved.edits.length > 10_000 ||
      saved.edits.some(
        (edit: PendingEdit) => typeof edit.id !== "string" || !Array.isArray(edit.changes),
      )
    )
      throw new Error("The local workspace edit journal needs recovery");
    this.edits = saved.edits;
  }
  get pending(): readonly PendingEdit[] {
    return this.edits;
  }
  async flush(): Promise<void> {
    await this.storage.flush?.();
  }
  append(changes: WorkspaceChange[], activeEpoch?: string): void {
    const additions: PendingEdit[] = [];
    let batch: WorkspaceChange[] = [];
    const flush = () => {
      if (batch.length) additions.push({ id: crypto.randomUUID(), changes: batch, activeEpoch });
      batch = [];
    };
    for (const change of changes) {
      if (
        batch.length >= 256 ||
        new TextEncoder().encode(JSON.stringify([...batch, change])).length > 900_000
      )
        flush();
      if (new TextEncoder().encode(JSON.stringify(change)).length > 900_000)
        throw new Error("This workspace edit exceeds the sync limit");
      batch.push(change);
    }
    flush();
    this.save([...this.edits, ...additions]);
  }
  appendResume(resume: Resume, activeEpoch?: string): void {
    this.save([...this.edits, { id: crypto.randomUUID(), changes: [], resume, activeEpoch }]);
  }
  retainActiveEpoch(activeEpoch: string | null): void {
    const retired = this.edits.filter((edit) => !activeEpoch || edit.activeEpoch !== activeEpoch);
    if (!retired.length) return;
    // Preserve unsent edits for recovery, but never relabel a follower's edits
    // as work performed during a later active-device tenure.
    this.storage.setItem(`${this.key}:retired:${crypto.randomUUID()}`, JSON.stringify(retired));
    this.save(this.edits.filter((edit) => activeEpoch && edit.activeEpoch === activeEpoch));
  }
  acknowledge(id: string): void {
    if (this.edits[0]?.id !== id) throw new Error("Workspace edit acknowledgment was out of order");
    this.save(this.edits.slice(1));
  }
  private save(edits: PendingEdit[]): void {
    const encoded = JSON.stringify({ version: 1, edits });
    if (edits.length > 10_000 || encoded.length > 16_000_000)
      throw new Error("Too many workspace edits are waiting to be saved");
    this.storage.setItem(this.key, encoded); // Keep the previous journal if storage fails.
    this.edits = edits;
  }
}

export function editJournalKey(identity: {
  deployment: string;
  account_id: string;
  workspace_id: string;
  device_id: string;
}) {
  return `misty:workspace-edit-journal:v1:${JSON.stringify([identity.deployment, identity.account_id, identity.workspace_id, identity.device_id])}`;
}
