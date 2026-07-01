import { invoke } from "@tauri-apps/api/core";
import { nativeWorkspaceRecoveryEnabled } from "./workspaceRecoveryPlatform";
import {
  closeNativeWorkspaceRecovery,
  flushNativeWorkspace,
  restoreNativeWorkspace,
} from "./nativeWorkspaceRecovery";
import { deploymentStorageKey, resolveApiBase } from "@/api/deployment/api";
import {
  browserWorkspaceStoreVersion,
  workspaceRecoveryKey,
  workspaceRecoveryStorage,
} from "./workspaceRecoveryStorage";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { migrateWorkspaceStore, partialWorkspaceStore } from "./workspaceStorePersistence";

function workspaceAccountStorageKey(accountId: string): string {
  return deploymentStorageKey(`misty:workspace-account:${accountId}`);
}

export function saveAccountWorkspace(accountId: string): void | Promise<void> {
  if (nativeWorkspaceRecoveryEnabled()) return flushNativeWorkspace(accountId);
  const normalized = accountId.trim();
  if (!normalized) return;
  try {
    const state = partialWorkspaceStore(useWorkspaceStore.getState());
    workspaceRecoveryStorage(window.localStorage).setItem(
      workspaceAccountStorageKey(normalized),
      JSON.stringify({ version: browserWorkspaceStoreVersion, state }),
    );
  } catch {
    // Local storage may be restricted in private/sandbox mode.
  }
}

export function restoreAccountWorkspace(accountId: string): void | Promise<void> {
  if (nativeWorkspaceRecoveryEnabled()) return restoreNativeWorkspace(accountId);
  const normalized = accountId.trim();
  if (!normalized) {
    useWorkspaceStore.getState().reset();
    return;
  }
  try {
    const raw = workspaceRecoveryStorage(window.localStorage).getItem(
      workspaceAccountStorageKey(normalized),
    );
    if (raw) {
      const parsed = JSON.parse(raw);
      const envelope = typeof parsed?.version === "number" && parsed?.state;
      const migrated = migrateWorkspaceStore(
        envelope ? parsed.state : parsed,
        envelope ? parsed.version : 11,
      );
      useWorkspaceStore.setState({
        ...migrated,
      });
      return;
    }
  } catch {
    // If reading or parsing failed, fall back to fresh initial workspace.
  }
  useWorkspaceStore.getState().reset();
}

export function removeAccountWorkspace(accountId: string): void | Promise<void> {
  if (nativeWorkspaceRecoveryEnabled()) return removeNativeAccountWorkspace(accountId);
  const normalized = accountId.trim();
  if (!normalized) return;
  try {
    const key = workspaceAccountStorageKey(normalized);
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(workspaceRecoveryKey(key));
  } catch {}
}

export function resetWorkspaceAccountState(): void {
  if (nativeWorkspaceRecoveryEnabled()) closeNativeWorkspaceRecovery();
  useWorkspaceStore.getState().reset();
}

async function removeNativeAccountWorkspace(accountId: string) {
  await invoke("browser_recovery_forget", { apiBase: await resolveApiBase(), accountId });
  const key = workspaceAccountStorageKey(accountId);
  localStorage.removeItem(key);
  localStorage.removeItem(workspaceRecoveryKey(key));
}
