import { create } from "zustand";
import { deploymentStorageKey, resolveApiBase } from "@/api/deployment/api";
import { readApiSessionGeneration } from "@/api/client/session";
import {
  openWorkspaceRecovery,
  recoveryKey,
  registerRecoveryFlush,
  type NativeRecoveryStorage,
} from "@/features/browser-workspace/recovery";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { migrateWorkspaceStore, partialWorkspaceStore } from "./workspaceStorePersistence";
import { browserWorkspaceStoreVersion, workspaceRecoveryKey } from "./workspaceRecoveryStorage";
import { workspaceStoreStorageKey, legacyWorkspaceCandidate } from "./workspaceRecoveryPlatform";

const key = "workspace";
export const useWorkspaceRecoveryState = create<{
  accountId: string | null;
  ready: boolean;
  issue: string | null;
}>(() => ({ accountId: null, ready: false, issue: null }));
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
  useWorkspaceRecoveryState.setState({ accountId: null, ready: false, issue: null });
}
export async function flushNativeWorkspace(accountId: string) {
  if (!owner) return;
  if (owner.accountId !== accountId)
    throw new Error("The workspace account changed before saving.");
  await owner.flush();
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
  ) {}
  changed() {
    this.since ??= Date.now();
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        void this.flush().catch(this.failed);
      },
      Math.max(0, Math.min(400, 2000 - (Date.now() - this.since))),
    );
  }
  async flush() {
    this.cancel();
    this.storage.setItem(key, this.capture());
    await this.storage.flush();
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
  const attempt = ++epoch;
  const valid = () => attempt === epoch && generation === readApiSessionGeneration();
  useWorkspaceRecoveryState.setState({ accountId, ready: false, issue: null });
  let recovery: Awaited<ReturnType<typeof openWorkspaceRecovery>> | undefined;
  try {
    const apiBase = await resolveApiBase();
    if (!valid()) return;
    recovery = await openWorkspaceRecovery(apiBase, accountId);
    const storage = recovery.storage;
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
    if (persisted !== null) {
      const parsed = JSON.parse(persisted);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error(
          "The saved workspace needs recovery. Its original copy has been preserved.",
        );
      const envelope = typeof parsed.version === "number" && parsed.state;
      const state = migrateWorkspaceStore(
        envelope ? parsed.state : parsed,
        envelope ? parsed.version : 11,
      );
      if (!valid()) return;
      // Commit the selected raw recovery before changing visible state or deleting
      // browser copies. It can be migrated again after an interrupted launch.
      if (storage.getItem(key) === null) storage.setItem(key, persisted);
      await storage.flush();
      if (!valid()) return;
      useWorkspaceStore.setState(state);
    } else {
      if (!valid()) return;
      useWorkspaceStore.getState().reset();
    }
    const capture = () =>
      JSON.stringify({
        version: browserWorkspaceStoreVersion,
        state: partialWorkspaceStore(useWorkspaceStore.getState()),
      });
    const writer = new WorkspaceRecoveryWriter(storage, capture, (error) => {
      if (!valid()) return;
      const issue = failure(error);
      useWorkspaceRecoveryState.setState({ issue });
      // Load the public shell entry lazily: its route exports import the
      // workspace store, so an eager dependency creates a hydration cycle.
      void import("@/features/app-shell").then(({ useAppStore }) => {
        if (valid()) useAppStore.getState().setError(issue);
      });
    });
    await writer.flush();
    if (!valid()) return;
    for (const [source, raw] of sources) {
      if (localStorage.getItem(source) === raw) localStorage.removeItem(source);
    }
    const unsubscribe = useWorkspaceStore.subscribe(() => writer.changed());
    const flush = async () => {
      await writer.flush();
      if (valid()) useWorkspaceRecoveryState.setState({ issue: null });
    };
    const unregister = registerRecoveryFlush(flush);
    const release = recovery.release;
    owner = {
      accountId,
      storage,
      flush,
      close: () => {
        writer.cancel();
        unsubscribe();
        unregister();
        release();
      },
    };
    recovery = undefined;
    useWorkspaceRecoveryState.setState({ accountId, ready: true, issue: null });
  } catch (error) {
    if (valid())
      useWorkspaceRecoveryState.setState({ accountId, ready: false, issue: failure(error) });
    throw error;
  } finally {
    recovery?.release();
  }
}
