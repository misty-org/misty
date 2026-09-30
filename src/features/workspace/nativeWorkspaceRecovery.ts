import { create } from "zustand";
import { deploymentStorageKey, resolveApiBase } from "@/api/deployment/api";
import { readApiSessionGeneration } from "@/api/client/session";
import {
  openWorkspaceRecovery,
  recoveryKey,
  registerRecoveryFlush,
  type NativeRecoveryStorage,
  type RecoverySaveStatus,
} from "@/features/browser-workspace/recovery";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { migrateWorkspaceStore, partialWorkspaceStore } from "./workspaceStorePersistence";
import { browserWorkspaceStoreVersion, workspaceRecoveryKey } from "./workspaceRecoveryStorage";
import { workspaceStoreStorageKey, legacyWorkspaceCandidate } from "./workspaceRecoveryPlatform";
import { mergeRecoveredWorkspace } from "./mergeRecoveredWorkspace";
import type { WorkspaceStore } from "./useWorkspaceStore";
import { initialWorkspaceWindow } from "./windows";
import { collectUnrestoredViews, type UnrestoredView } from "./workspaceMigrations";
import { SaveRetryBackoff } from "./saveRetryBackoff";

const key = "workspace";
const noSaves: RecoverySaveStatus = { pending: [], failed: [] };
const closedRecoveryState = {
  accountId: null,
  ready: false,
  usable: false,
  issue: null,
  saves: noSaves,
  notRestored: [],
};
/** `issue` means this device cannot save at all. Per-item results live in
 * `saves` (waiting in the pending file, or refused) and `notRestored`. */
export const useWorkspaceRecoveryState = create<{
  accountId: string | null;
  ready: boolean;
  usable: boolean;
  issue: string | null;
  saves: RecoverySaveStatus;
  notRestored: UnrestoredView[];
}>(() => ({ ...closedRecoveryState }));
let temporary:
  | {
      accountId: string;
      baseline: ReturnType<typeof partialWorkspaceStore>;
      unregister: () => void;
    }
  | undefined;
let syncBaseline: Partial<WorkspaceStore> | undefined;
export function pendingRecoveredWorkspace(accountId: string) {
  return owner?.accountId === accountId ? syncBaseline : undefined;
}
export async function acknowledgeRecoveredWorkspace(accountId: string) {
  if (owner?.accountId !== accountId) return;
  syncBaseline = undefined;
  await owner.flush();
}
const captureWorkspace = () =>
  JSON.stringify({
    version: browserWorkspaceStoreVersion,
    state: partialWorkspaceStore(useWorkspaceStore.getState()),
    syncBaseline,
  });
let epoch = 0;
let owner:
  | {
      accountId: string;
      storage: NativeRecoveryStorage;
      flush: () => Promise<void>;
      close: () => void;
    }
  | undefined;
let opening: { accountId: string; generation: number; task: Promise<void> } | undefined;

function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function closeNativeWorkspaceRecovery() {
  epoch++;
  owner?.close();
  owner = undefined;
  opening = undefined;
  temporary?.unregister();
  temporary = undefined;
  syncBaseline = undefined;
  useWorkspaceRecoveryState.setState({ ...closedRecoveryState });
}
export async function flushNativeWorkspace(accountId: string) {
  if (temporary) {
    if (temporary.accountId !== accountId)
      throw new Error("The workspace account changed before saving.");
    assertTemporarySaved();
  }
  if (!owner) return;
  if (owner.accountId !== accountId)
    throw new Error("The workspace account changed before saving.");
  await owner.flush();
}

function assertTemporarySaved() {
  if (
    temporary &&
    JSON.stringify(partialWorkspaceStore(useWorkspaceStore.getState())) !==
      JSON.stringify(temporary.baseline)
  )
    throw new Error(
      "This workspace has unsaved changes. Wait for local recovery before changing accounts.",
    );
}

/** A failed read must not expose the previous account or overwrite its saved
 * data. This account gets a temporary in-memory workspace until recovery works. */
export function continueWithTemporaryWorkspace(accountId: string, error: unknown) {
  if (!temporary && !owner) {
    useWorkspaceStore.getState().reset();
    temporary = {
      accountId,
      baseline: partialWorkspaceStore(useWorkspaceStore.getState()),
      unregister: registerRecoveryFlush(async () => assertTemporarySaved()),
    };
  }
  useWorkspaceRecoveryState.setState({ accountId, usable: true, issue: failure(error) });
}

/** Snapshot at the end of a burst, not on every resize frame. The recovery store
 * retains the exact failed write for a retry before accepting the newest value. */
export class WorkspaceRecoveryWriter {
  private timer?: ReturnType<typeof setTimeout>;
  private since?: number;
  constructor(
    private storage: NativeRecoveryStorage,
    private capture: () => string,
    private failed: (error: unknown) => void,
    private saved: () => void = () => undefined,
  ) {}
  changed() {
    this.since ??= Date.now();
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        void this.flush().then(this.saved, this.failed);
      },
      Math.max(0, Math.min(400, 2000 - (Date.now() - this.since))),
    );
  }
  /** `retry` also re-attempts saves native refused before; background saves
   * leave those alone until their value changes. */
  async flush(retry = false) {
    this.cancel();
    this.storage.setItem(key, this.capture());
    await (retry ? this.storage.retry() : this.storage.flush());
  }
  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.since = undefined;
  }
}

export function restoreNativeWorkspace(accountId: string): Promise<void> {
  if (owner?.accountId === accountId) return owner.flush();
  const generation = readApiSessionGeneration();
  if (opening?.accountId === accountId && opening.generation === generation) return opening.task;
  const task = restore(accountId, generation);
  opening = { accountId, generation, task };
  void task
    .finally(() => {
      if (opening?.task === task) opening = undefined;
    })
    .catch(() => undefined);
  return task;
}
async function restore(accountId: string, generation: number) {
  if (owner) throw new Error("Save and close the previous workspace before changing accounts.");
  if (temporary && temporary.accountId !== accountId)
    throw new Error("Save and close the previous workspace before changing accounts.");
  const attempt = ++epoch;
  const valid = () => attempt === epoch && generation === readApiSessionGeneration();
  useWorkspaceRecoveryState.setState({ accountId, ready: false, notRestored: [] });
  let recovery: Awaited<ReturnType<typeof openWorkspaceRecovery>> | undefined;
  try {
    const apiBase = await resolveApiBase();
    if (!valid()) return;
    let backoff: SaveRetryBackoff | undefined;
    recovery = await openWorkspaceRecovery(apiBase, accountId, (saves) => {
      if (!valid()) return;
      useWorkspaceRecoveryState.setState({ saves });
      backoff?.update(saves.failed.length);
    });
    const storage = recovery.storage;
    // Refused saves are listed per item in `saves`; only other failures are an issue.
    const saveIssue = (error: unknown) => (storage.status().failed.length ? null : failure(error));
    await storage.load(key);
    if (!valid()) return;
    const legacyKey = deploymentStorageKey(`misty:workspace-account:${accountId}`);
    const sources: [string, string][] = [];
    const accountRaw = localStorage.getItem(legacyKey);
    const accountBackup = localStorage.getItem(workspaceRecoveryKey(legacyKey));
    if (accountRaw !== null) sources.push([legacyKey, accountRaw]);
    if (accountBackup !== null) sources.push([workspaceRecoveryKey(legacyKey), accountBackup]);
    const candidate = legacyWorkspaceCandidate();
    const global = candidate?.owner === accountId ? candidate : undefined;
    if (global && localStorage.getItem(workspaceStoreStorageKey) === global.raw) {
      sources.push([workspaceStoreStorageKey, global.raw]);
      if (global.backup !== null)
        sources.push([workspaceRecoveryKey(workspaceStoreStorageKey), global.backup]);
    }
    // Archive every original before decoding or normalizing any of them.
    for (const [source, raw] of sources) {
      const archive = await recoveryKey("archive", [source, raw]);
      await storage.load(archive);
      storage.setItem(archive, raw);
    }
    const persisted =
      storage.getItem(key) ??
      (global && sources.some(([name]) => name === workspaceStoreStorageKey)
        ? global.raw
        : accountRaw);
    let restored: ReturnType<typeof migrateWorkspaceStore> | undefined;
    if (persisted !== null) {
      // Preserve the original before decoding it, so whatever cannot be
      // restored below is still kept exactly as it was saved.
      const archive = await recoveryKey("archive", [key, persisted]);
      await storage.load(archive);
      storage.setItem(archive, persisted);
      if (!valid()) return;
      const { result, skipped } = collectUnrestoredViews(() => {
        try {
          const parsed = JSON.parse(persisted);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error("The saved windows and tabs are not in a readable format.");
          const envelope = typeof parsed.version === "number" && parsed.state;
          const state = migrateWorkspaceStore(
            envelope ? parsed.state : parsed,
            envelope ? parsed.version : 11,
          );
          if (!state.layout) Object.assign(state, initialWorkspaceWindow());
          if (parsed.syncBaseline)
            syncBaseline = migrateWorkspaceStore(parsed.syncBaseline, browserWorkspaceStoreVersion);
          return { state, error: null };
        } catch (error) {
          return { state: undefined, error };
        }
      });
      restored = result.state;
      // Report what did not come back instead of failing the whole restore.
      useWorkspaceRecoveryState.setState({
        notRestored: result.error
          ? [{ id: key, title: "Saved windows and tabs", reason: failure(result.error) }]
          : skipped,
      });
    }
    if (!valid()) return;
    if (temporary?.accountId === accountId) {
      const live = useWorkspaceStore.getState();
      const changed =
        JSON.stringify(partialWorkspaceStore(live)) !== JSON.stringify(temporary.baseline);
      if (restored)
        useWorkspaceStore.setState(
          changed ? mergeRecoveredWorkspace(restored, live, temporary.baseline) : restored,
        );
      if (changed) syncBaseline ??= restored ?? temporary.baseline;
      temporary.unregister();
      temporary = undefined;
    } else if (restored) {
      useWorkspaceStore.setState(restored);
    } else {
      useWorkspaceStore.getState().reset();
    }
    const restoredBaseline = partialWorkspaceStore(useWorkspaceStore.getState());
    const writer = new WorkspaceRecoveryWriter(
      storage,
      captureWorkspace,
      (error) => {
        if (valid()) useWorkspaceRecoveryState.setState({ issue: saveIssue(error) });
      },
      // A later save that lands clears an earlier failure.
      () => {
        if (valid() && useWorkspaceRecoveryState.getState().issue)
          useWorkspaceRecoveryState.setState({ issue: null });
      },
    );
    const unsubscribe = useWorkspaceStore.subscribe(() => writer.changed());
    // Callers of this flush (retry, account switch, acknowledging a restore)
    // ask explicitly, so refused saves are tried again.
    const flush = async () => {
      try {
        await writer.flush(true);
        if (!valid()) return;
        for (const [source, raw] of sources) {
          if (localStorage.getItem(source) === raw) localStorage.removeItem(source);
        }
        useWorkspaceRecoveryState.setState({ ready: true, issue: null });
      } catch (error) {
        if (valid()) {
          if (!useWorkspaceRecoveryState.getState().ready) syncBaseline ??= restoredBaseline;
          useWorkspaceRecoveryState.setState({ issue: saveIssue(error) });
        }
        throw error;
      }
    };
    const unregister = registerRecoveryFlush(flush);
    backoff = new SaveRetryBackoff(flush);
    const retries = backoff;
    const release = recovery.release;
    owner = {
      accountId,
      storage,
      flush,
      close: () => {
        retries.dispose();
        writer.cancel();
        unsubscribe();
        unregister();
        release();
      },
    };
    recovery = undefined;
    useWorkspaceRecoveryState.setState({ accountId, usable: true });
    // The workspace is restored even if some saves were refused; those are
    // listed per item and retried, not a reason for a temporary workspace.
    await flush().catch((error) => {
      if (!storage.status().failed.length) throw error;
    });
  } catch (error) {
    if (valid()) continueWithTemporaryWorkspace(accountId, error);
  } finally {
    recovery?.release();
  }
}
