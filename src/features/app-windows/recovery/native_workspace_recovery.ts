import { resolveApiBase } from "@/api/deployment/api";
import { readApiSessionGeneration } from "@/api/client/session";
import {
  openWorkspaceRecovery,
  recoveryKey,
  registerRecoveryFlush,
  type NativeRecoveryStorage,
} from "./recovery_storage";
import { useWorkspaceStore } from "../tabs/use_workspace_store";
import { partialWorkspaceStore } from "../tabs/workspace_store_persistence";
import { mergeRecoveredWorkspace } from "./merge_recovered_workspace";
import { SaveRetryBackoff } from "./save_retry_backoff";
import { currentWindowId, refreshProfileWindow } from "../profiles/profile_window";
import { startProfileTabs } from "../tabs/profile_tabs";
import { startWindowOrphans } from "./window_orphans";
import { parseWorkspaceRecord } from "../tabs/workspace_record";
import {
  readRecoveryRecord,
  windowRecoveryKey,
  WorkspaceRecoveryWriter,
} from "./workspace_recovery_writer";
import { captureWorkspace, failure, type TemporaryWorkspace } from "./native_recovery_parts";
import { closedRecoveryState, useWorkspaceRecoveryState } from "./workspace_recovery_state";

export { useWorkspaceRecoveryState };

let temporary: TemporaryWorkspace | undefined;
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

export function closeNativeWorkspaceRecovery() {
  epoch++;
  owner?.close();
  owner = undefined;
  opening = undefined;
  temporary?.unregister();
  temporary = undefined;
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

export function restoreNativeWorkspace(accountId: string, keepLive = false): Promise<void> {
  if (owner?.accountId === accountId) return owner.flush();
  const generation = readApiSessionGeneration();
  if (opening?.accountId === accountId && opening.generation === generation) return opening.task;
  const task = restore(accountId, generation, keepLive);
  opening = { accountId, generation, task };
  void task
    .finally(() => {
      if (opening?.task === task) opening = undefined;
    })
    .catch(() => undefined);
  return task;
}
async function restore(accountId: string, generation: number, keepLive: boolean) {
  if (owner) throw new Error("Save and close the previous workspace before changing accounts.");
  if (temporary && temporary.accountId !== accountId)
    throw new Error("Save and close the previous workspace before changing accounts.");
  const attempt = ++epoch;
  const valid = () => attempt === epoch && generation === readApiSessionGeneration();
  useWorkspaceRecoveryState.setState({ accountId, ready: false });
  let recovery: Awaited<ReturnType<typeof openWorkspaceRecovery>> | undefined;
  try {
    const apiBase = await resolveApiBase();
    if (!valid()) return;
    let backoff: SaveRetryBackoff | undefined = undefined;
    recovery = await openWorkspaceRecovery(apiBase, accountId, (saves) => {
      if (!valid()) return;
      useWorkspaceRecoveryState.setState({ saves });
      backoff?.update(saves.failed.length);
    });
    const storage = recovery.storage;
    const saveIssue = (error: unknown) => (storage.status().failed.length ? null : failure(error));
    await refreshProfileWindow();
    if (!valid()) return;
    const key = windowRecoveryKey(currentWindowId());
    await storage.load(key);
    if (!valid()) return;
    const persisted = readRecoveryRecord(storage, key);
    let restored: ReturnType<typeof parseWorkspaceRecord> | undefined;
    if (persisted !== null) {
      const archive = await recoveryKey("archive", [key, persisted]);
      await storage.load(archive);
      storage.setItem(archive, persisted);
      if (!valid()) return;
      try {
        restored = parseWorkspaceRecord(persisted);
      } catch {
        restored = undefined;
      }
    }
    if (!valid()) return;
    if (keepLive) {
      temporary?.unregister();
      temporary = undefined;
    } else if (temporary?.accountId === accountId) {
      const live = useWorkspaceStore.getState();
      const changed =
        JSON.stringify(partialWorkspaceStore(live)) !== JSON.stringify(temporary.baseline);
      if (restored)
        useWorkspaceStore.setState(changed ? mergeRecoveredWorkspace(restored, live) : restored);
      temporary.unregister();
      temporary = undefined;
    } else if (restored) {
      useWorkspaceStore.setState(restored);
    } else {
      useWorkspaceStore.getState().reset();
    }
    const writer = new WorkspaceRecoveryWriter(
      storage,
      key,
      captureWorkspace,
      (error) => {
        if (valid()) useWorkspaceRecoveryState.setState({ issue: saveIssue(error) });
      },
      () => {
        if (valid() && useWorkspaceRecoveryState.getState().issue)
          useWorkspaceRecoveryState.setState({ issue: null });
      },
    );
    const unsubscribe = useWorkspaceStore.subscribe(() => writer.changed());
    const flush = async () => {
      try {
        await writer.flush(true);
        if (!valid()) return;
        useWorkspaceRecoveryState.setState({ ready: true, issue: null });
      } catch (error) {
        if (valid()) useWorkspaceRecoveryState.setState({ issue: saveIssue(error) });
        throw error;
      }
    };
    const unregister = registerRecoveryFlush(flush);
    backoff = new SaveRetryBackoff(flush);
    const retries = backoff;
    const release = recovery.release;
    const stopOrphans = startWindowOrphans(storage, () => writer.flush(true));
    const stopTabs = startProfileTabs();
    owner = {
      accountId,
      storage,
      flush,
      close: () => {
        retries.dispose();
        writer.cancel();
        unsubscribe();
        unregister();
        stopOrphans();
        stopTabs();
        release();
      },
    };
    recovery = undefined;
    useWorkspaceRecoveryState.setState({ accountId, usable: true });
    await flush().catch((error) => {
      if (!storage.status().failed.length) throw error;
    });
  } catch (error) {
    if (valid()) continueWithTemporaryWorkspace(accountId, error);
  } finally {
    recovery?.release();
  }
}
