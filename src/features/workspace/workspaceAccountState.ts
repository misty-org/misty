import { deploymentStorageKey } from "@/api/deployment/api";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { migrateWorkspaceStore, partialWorkspaceStore } from "./workspaceStorePersistence";

function workspaceAccountStorageKey(accountId: string): string {
  return deploymentStorageKey(`misty:workspace-account:${accountId}`);
}

export function saveAccountWorkspace(accountId: string): void {
  const normalized = accountId.trim();
  if (!normalized) return;
  try {
    const state = partialWorkspaceStore(useWorkspaceStore.getState());
    window.localStorage.setItem(workspaceAccountStorageKey(normalized), JSON.stringify(state));
  } catch {
    // Local storage may be restricted in private/sandbox mode.
  }
}

export function restoreAccountWorkspace(accountId: string): void {
  const normalized = accountId.trim();
  if (!normalized) {
    useWorkspaceStore.getState().reset();
    return;
  }
  try {
    const raw = window.localStorage.getItem(workspaceAccountStorageKey(normalized));
    if (raw) {
      const parsed = JSON.parse(raw);
      const migrated = migrateWorkspaceStore(parsed, 11);
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

export function removeAccountWorkspace(accountId: string): void {
  const normalized = accountId.trim();
  if (!normalized) return;
  try {
    window.localStorage.removeItem(workspaceAccountStorageKey(normalized));
  } catch {}
}

export function resetWorkspaceAccountState(): void {
  useWorkspaceStore.getState().reset();
}
