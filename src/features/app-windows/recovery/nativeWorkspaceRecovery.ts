import { resolveApiBase } from "@/api/deployment/api";
import { readApiSessionGeneration } from "@/api/client/session";
import {
  openWorkspaceRecovery,
  recoveryKey,
  registerRecoveryFlush,
  type NativeRecoveryStorage,
} from "./recoveryStorage";
import { useWorkspaceStore } from "../tabs/useWorkspaceStore";
import { partialWorkspaceStore } from "../tabs/workspaceStorePersistence";
import { mergeRecoveredWorkspace } from "./mergeRecoveredWorkspace";
import { SaveRetryBackoff } from "./saveRetryBackoff";
import { currentWindowId, refreshProfileWindow } from "../profiles/profileWindow";
import { startProfileTabs } from "../tabs/profileTabs";
import { startWindowOrphans } from "./windowOrphans";
import { parseWorkspaceRecord } from "../tabs/workspaceRecord";
import {
  readRecoveryRecord,
  windowRecoveryKey,
  WorkspaceRecoveryWriter,
} from "./workspaceRecoveryWriter";
import { captureWorkspace, failure, type TemporaryWorkspace } from "./nativeRecoveryParts";
import { closedRecoveryState, useWorkspaceRecoveryState } from "./workspaceRecoveryState";

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

/**
 * Opens a profile's saved windows and tabs. `keepLive` keeps what the window shows now and
 * saves it as that profile's instead: signing in adopts the local profile's tabs, and signing
 * out hands them back. A record the profile had
 * is archived first, never lost.
 */
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
    // Refused saves are listed per item in `saves`; only other failures are an issue.
    const saveIssue = (error: unknown) => (storage.status().failed.length ? null : failure(error));
    // After an account change this window's profile can be another one.
    await refreshProfileWindow();
    if (!valid()) return;
    const key = windowRecoveryKey(currentWindowId());
    await storage.load(key);
    if (!valid()) return;
    const persisted = readRecoveryRecord(storage, key);
    let restored: ReturnType<typeof parseWorkspaceRecord> | undefined;
    if (persisted !== null) {
      // Preserve the original before decoding it, so whatever cannot be
      // restored below is still kept exactly as it was saved.
      const archive = await recoveryKey("archive", [key, persisted]);
      await storage.load(archive);
      storage.setItem(archive, persisted);
      if (!valid()) return;
      try {
        restored = parseWorkspaceRecord(persisted);
      } catch {
        // A record that can't be read starts the window fresh; its original is archived above.
        restored = undefined;
      }
    }
    if (!valid()) return;
    if (keepLive) {
      // The live windows and tabs become this profile's; its old record stays archived above.
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
