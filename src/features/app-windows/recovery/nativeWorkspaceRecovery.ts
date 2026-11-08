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
import { collectUnrestoredViews } from "./workspaceMigrations";
import { SaveRetryBackoff } from "./saveRetryBackoff";
import {
  currentProfile,
  currentWindowId,
  firstProfileId,
  refreshProfileWindow,
} from "../profiles/profileWindow";
import {
  recordSeed,
  startProfileRecords,
  type ProfileRecordCollection,
  type ProfileRecordsHandle,
} from "../profiles/profileRecords";
import type { SharedRecord } from "../profiles/profileRecordModel";
import { legacyBrowserSources } from "./legacyBrowserSources";
import { startProfileTabs } from "../tabs/profileTabs";
import { startWindowOrphans } from "./windowOrphans";
import { parseWorkspaceRecord } from "../tabs/workspaceRecord";
import {
  legacyWorkspaceRecoveryKey,
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
let records: ProfileRecordsHandle | undefined;

function openProfileRecords(seed?: Partial<Record<ProfileRecordCollection, SharedRecord[]>>) {
  records?.stop();
  records = startProfileRecords(seed);
  return records;
}

export function closeNativeWorkspaceRecovery() {
  epoch++;
  owner?.close();
  owner = undefined;
  opening = undefined;
  temporary?.unregister();
  temporary = undefined;
  records?.stop();
  records = undefined;
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
    // Bookmarks are the profile's and don't wait on this window's own saved tabs.
    openProfileRecords();
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
  useWorkspaceRecoveryState.setState({ accountId, ready: false, notRestored: [] });
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
    // Only the first profile's window takes over what was saved before windows had ids.
    const legacy = currentProfile().id === firstProfileId;
    if (legacy) await storage.load(legacyWorkspaceRecoveryKey);
    if (!valid()) return;
    let legacyRecord = legacy ? readRecoveryRecord(storage, legacyWorkspaceRecoveryKey) : null;
    const { sources, newest } = legacyBrowserSources(accountId, legacy);
    // Archive every original before decoding or normalizing any of them.
    for (const [source, raw] of sources) {
      const archive = await recoveryKey("archive", [source, raw]);
      await storage.load(archive);
      storage.setItem(archive, raw);
    }
    const persisted = readRecoveryRecord(storage, key) ?? legacyRecord ?? newest;
    let restored: ReturnType<typeof parseWorkspaceRecord> | undefined;
    if (persisted !== null) {
      // Preserve the original before decoding it, so whatever cannot be
      // restored below is still kept exactly as it was saved.
      const archive = await recoveryKey("archive", [key, persisted]);
      await storage.load(archive);
      storage.setItem(archive, persisted);
      if (!valid()) return;
      const { result, skipped } = collectUnrestoredViews(() => {
        try {
          return { state: parseWorkspaceRecord(persisted), error: null };
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
    if (keepLive) {
      // The live windows and tabs become this profile's; its old record stays archived above.
      useWorkspaceRecoveryState.setState({ notRestored: [] });
      temporary?.unregister();
      temporary = undefined;
    } else if (temporary?.accountId === accountId) {
      const live = useWorkspaceStore.getState();
      const changed =
        JSON.stringify(partialWorkspaceStore(live)) !== JSON.stringify(temporary.baseline);
      if (restored)
        useWorkspaceStore.setState(
          changed ? mergeRecoveredWorkspace(restored, live, temporary.baseline) : restored,
        );
      temporary.unregister();
      temporary = undefined;
    } else if (restored) {
      useWorkspaceStore.setState(restored);
    } else {
      useWorkspaceStore.getState().reset();
    }
    // What this window held from before records were the profile's. A legacy record kept from
    // an earlier start that couldn't write them gets another try.
    let seedState: Parameters<typeof recordSeed>[0] = useWorkspaceStore.getState();
    if (legacyRecord && legacyRecord !== persisted && !keepLive) {
      try {
        seedState = parseWorkspaceRecord(legacyRecord);
      } catch {
        // Nothing readable to bring over; its archived copy stays.
      }
    }
    const handle = openProfileRecords(recordSeed(seedState));
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
        for (const [source, raw] of sources) {
          if (localStorage.getItem(source) === raw) localStorage.removeItem(source);
        }
        // The old record goes once its tabs are saved here and its bookmarks are the profile's.
        if (legacyRecord && handle.seeded()) {
          legacyRecord = null;
          storage.setItem(legacyWorkspaceRecoveryKey, "");
          await storage.flush();
        }
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
    if (legacyRecord)
      void handle.whenSeeded.then(() => (valid() ? flush().catch(() => undefined) : undefined));
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
