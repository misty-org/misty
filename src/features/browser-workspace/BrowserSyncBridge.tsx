import { useEffect } from "react";
import { resolveApiBase } from "@/api/deployment/api";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import { useAppStore } from "@/features/app-shell";
import { accountScopeWillResetEvent } from "@/features/auth";
import { partialWorkspaceStore } from "@/features/workspace/workspaceStorePersistence";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import {
  acknowledgeRecoveredWorkspace,
  pendingRecoveredWorkspace,
} from "@/features/workspace/nativeWorkspaceRecovery";
import { workspaceChanges } from "./changes";
import { recordChanges } from "./recordChanges";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { canProjectWorkspace, WorkspaceSyncController } from "./controller";
import { EditJournal, editJournalKey } from "./editJournal";
import {
  migrateRecoveryRecord,
  openWorkspaceRecovery,
  recoveryKey,
  registerRecoveryFlush,
} from "./recovery";
import {
  saveNativeResume,
  editNativeWorkspace,
  readNativeSync,
  watchNativeSync,
  watchNativeProfile,
  activeDeviceEpoch,
} from "./native";
import { browserProfileChanged } from "@/features/webviews/browserRuntime";
import { workspaceSource } from "./source";
import { useBrowserSyncStore } from "./store";

export function BrowserSyncBridge({ accountId }: { accountId: string }) {
  useEffect(() => {
    if (!accountId || !hasTauriInternals()) return;
    let active = true;
    let controller: WorkspaceSyncController | undefined;
    let detach: (() => void) | undefined;
    let detachProfile: (() => void) | undefined;
    let releaseRecovery: (() => void) | undefined;
    let removeFlush: (() => void) | undefined;
    let starting = false;
    let again = false;
    const generation = readApiSessionGeneration();
    const valid = () =>
      active && !isApiSessionTransitioning() && readApiSessionGeneration() === generation;
    const fail = (error: unknown) => {
      if (!valid()) return;
      const message = error instanceof Error ? error.message : String(error);
      useBrowserSyncStore.setState({ issue: message });
      useAppStore.getState().setError(message);
    };
    const stop = () => {
      active = false;
      controller?.stop();
      detach?.();
      detachProfile?.();
      releaseRecovery?.();
      removeFlush?.();
      useBrowserSyncStore.setState({ session: null, issue: null });
    };
    const changed = async () => {
      if (!valid()) return;
      if (controller) {
        controller.refresh();
        return;
      }
      if (starting) {
        again = true;
        return;
      }
      starting = true;
      try {
        const base = new URL(await resolveApiBase()).href.replace(/\/$/, "");
        const native = await readNativeSync();
        if (!valid() || !native || native.account_id !== accountId || native.deployment !== base)
          return;
        useBrowserSyncStore.setState({ session: native, issue: null });
        if (!canProjectWorkspace(native)) return;
        const recovery = await openWorkspaceRecovery(base, accountId);
        if (!valid()) {
          recovery.release();
          return;
        }
        releaseRecovery = recovery.release;
        const backupKey = "before-sync";
        await migrateRecoveryRecord(
          recovery.storage,
          backupKey,
          localStorage,
          `misty:pre-browser-sync:v1:${base}:${accountId}`,
          true,
        );
        const journalKey = await recoveryKey("edits", [native.workspace_id, native.device_id]);
        await migrateRecoveryRecord(
          recovery.storage,
          journalKey,
          localStorage,
          editJournalKey(native),
        );
        if (!valid()) return;
        if (recovery.storage.getItem(backupKey) === null) {
          recovery.storage.setItem(
            backupKey,
            JSON.stringify(partialWorkspaceStore(useWorkspaceStore.getState())),
          );
          await recovery.storage.flush();
        }
        if (!valid()) return;
        const journal = new EditJournal(recovery.storage, native, journalKey);
        const baseline = pendingRecoveredWorkspace(accountId);
        if (baseline) {
          const epoch = activeDeviceEpoch(native);
          // Keep recovered local edits visible until this device may publish.
          // Never turn work done during recovery into a follower projection.
          if (!epoch) {
            releaseRecovery?.();
            releaseRecovery = undefined;
            return;
          }
          journal.retainActiveEpoch(epoch);
          // A brand-new vault must seed the entire local workspace, not just
          // the recovery delta. The controller already owns that operation.
          if (
            native.workspace.records.length ||
            native.pending_operation_ids.length ||
            journal.pending.length
          ) {
            const live = workspaceSource.read();
            const changes = workspaceChanges(
              baseline.virtualWindowsByScope?.global ?? [],
              live.windows,
              native.profile_id,
            );
            journal.append(
              [
                ...changes.changes,
                ...recordChanges(
                  [...(baseline.websiteGroups ?? []), ...(baseline.savedWebsites ?? [])],
                  [...(live.groups ?? []), ...(live.websites ?? [])],
                ),
              ],
              epoch,
            );
            if (changes.remapped.size)
              workspaceSource.write({
                windows: changes.windows,
                activeWindowId: changes.remapped.get(live.activeWindowId) ?? live.activeWindowId,
                groups: live.groups ?? [],
                websites: live.websites ?? [],
                recoveryTabIds: [],
              });
          }
        }
        controller = new WorkspaceSyncController(native, {
          captureDelayMs: 400,
          source: {
            ...workspaceSource,
            subscribe(callback) {
              return workspaceSource.subscribe(() => {
                if (valid()) callback();
                else controller?.stop();
              });
            },
          },
          journal,
          read: readNativeSync,
          publish: editNativeWorkspace,
          publishResume: saveNativeResume,
          state(session, preserveIssue) {
            if (valid())
              useBrowserSyncStore.setState({ session, ...(preserveIssue ? {} : { issue: null }) });
          },
          error: fail,
          locked() {
            if (valid()) useBrowserSyncStore.setState({ session: null });
          },
          closed() {
            controller = undefined;
            if (active) useBrowserSyncStore.setState({ session: null });
          },
        });
        removeFlush = registerRecoveryFlush(() => controller?.flushLocal() ?? Promise.resolve());
        if (baseline) {
          // The edit journal must be durable before clearing its recovery
          // baseline. A failed save keeps the baseline available next launch.
          await journal.flush();
          if (valid()) await acknowledgeRecoveredWorkspace(accountId);
        }
      } catch (error) {
        if (!controller) {
          releaseRecovery?.();
          releaseRecovery = undefined;
        }
        fail(error);
      } finally {
        starting = false;
        if (again && valid()) {
          again = false;
          void changed();
        }
      }
    };
    // Subscribe first, then read, so a setup completed during mounting isn't lost.
    void watchNativeSync(() => {
      void changed();
    })
      .then((unlisten) => {
        if (!active) {
          unlisten();
          return;
        }
        detach = unlisten;
        void changed();
      })
      .catch(fail);
    window.addEventListener(accountScopeWillResetEvent, stop);
    void watchNativeProfile((sessionId) => {
      const currentProfile = () =>
        valid() && useBrowserSyncStore.getState().session?.session_id === sessionId;
      if (currentProfile()) void browserProfileChanged(currentProfile).catch(fail);
    })
      .then((unlisten) => {
        if (!active) unlisten();
        else detachProfile = unlisten;
      })
      .catch(fail);
    return () => {
      stop();
      window.removeEventListener(accountScopeWillResetEvent, stop);
    };
  }, [accountId]);
  return null;
}
