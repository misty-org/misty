import type { ProviderRemote, RemoteEditDraft } from "@/native/contracts";
import type {
  CachedRemoteDraft,
  ProvidersWorkspaceState,
} from "../model/stores/providers/interfaces/useProvidersStore";
import { configPriority, stableConfig } from "../providerUtils";
import type { ProvidersSet } from "./providerConnectionHelpers";

export function selectProviderWorkspaceDerived(workspace: ProvidersWorkspaceState) {
  return {
    dirty: isWorkspaceDirty(workspace),
    validRemoteName: workspace.draft ? isValidRemoteName(workspace.draft) : false,
    configKeys: workspace.draft
      ? Object.keys(workspace.draft.config)
          .filter((key) => key !== "type" && key !== "misty_connection_id")
          .sort(
            (left, right) =>
              configPriority(left) - configPriority(right) || left.localeCompare(right),
          )
      : [],
  };
}

export function createProvidersWorkspaceState(): ProvidersWorkspaceState {
  return {
    draft: null,
    originalDraft: null,
    configPaths: null,
    tokenVisible: false,
    loadingRemoteName: null,
    loadedRemoteRevision: 0,
    error: null,
    message: null,
  };
}

export function isProviderWorkspaceStale(
  workspace: ProvidersWorkspaceState,
  remoteRevisions: Record<string, number>,
  remotes: ProviderRemote[],
): boolean {
  const remoteName = workspace.draft?.originalName;
  if (!remoteName) return false;
  if (!remotes.some((remote) => remote.name === remoteName)) return true;
  return workspace.loadedRemoteRevision < revisionForRemote(remoteRevisions, remoteName);
}

export function isWorkspaceDirty(
  state: Pick<ProvidersWorkspaceState, "draft" | "originalDraft">,
): boolean {
  if (!state.draft || !state.originalDraft) return false;
  return (
    state.draft.name !== state.originalDraft.name ||
    stableConfig(state.draft.config) !== stableConfig(state.originalDraft.config)
  );
}

export function setWorkspaceState(
  set: ProvidersSet,
  workspaceId: string,
  patch: Partial<ProvidersWorkspaceState>,
): void {
  set((state) => {
    const current = state.workspaces[workspaceId] ?? createProvidersWorkspaceState();
    return {
      workspaces: {
        ...state.workspaces,
        [workspaceId]: { ...current, ...patch },
      },
    };
  });
}

export function pruneRemoteFromWorkspaces(
  workspaces: Record<string, ProvidersWorkspaceState>,
  name: string,
): Record<string, ProvidersWorkspaceState> {
  let changed = false;
  const next: Record<string, ProvidersWorkspaceState> = {};
  for (const [workspaceId, workspace] of Object.entries(workspaces)) {
    if (workspace.draft?.originalName === name || workspace.originalDraft?.originalName === name) {
      next[workspaceId] = { ...workspace, draft: null, originalDraft: null };
      changed = true;
    } else {
      next[workspaceId] = workspace;
    }
  }
  return changed ? next : workspaces;
}

export function removeRemoteDraftCache(
  cache: Record<string, CachedRemoteDraft>,
  name: string,
): Record<string, CachedRemoteDraft> {
  if (!(name in cache)) return cache;
  const next = { ...cache };
  delete next[name];
  return next;
}

export function pruneRemoteDraftCacheToRemotes(
  cache: Record<string, CachedRemoteDraft>,
  remotes: ProviderRemote[],
): Record<string, CachedRemoteDraft> {
  const remoteNames = new Set(remotes.map((remote) => remote.name));
  let changed = false;
  const next: Record<string, CachedRemoteDraft> = {};
  for (const [name, cached] of Object.entries(cache)) {
    if (remoteNames.has(name)) {
      next[name] = cached;
    } else {
      changed = true;
    }
  }
  return changed ? next : cache;
}

export function revisionForRemote(remoteRevisions: Record<string, number>, name: string): number {
  return remoteRevisions[name] ?? 0;
}

export function bumpRemoteRevisions(
  remoteRevisions: Record<string, number>,
  names: string[],
): Record<string, number> {
  const next = { ...remoteRevisions };
  for (const name of new Set(names.map((value) => value.trim()).filter(Boolean))) {
    next[name] = revisionForRemote(next, name) + 1;
  }
  return next;
}

export function isValidRemoteName(draft: RemoteEditDraft): boolean {
  const trimmed = draft.name.trim();
  return (
    trimmed.length > 0 &&
    !trimmed.includes(":") &&
    !trimmed.includes("/") &&
    !trimmed.includes("\\")
  );
}
