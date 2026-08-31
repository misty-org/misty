import { createInboxStore, type InboxStoreHook, useInboxStore } from "./useInboxStore";

const workspaceStores = new Map<string, InboxStoreHook>();

/**
 * Each outer Inbox tab owns a complete mail session. This keeps provider,
 * folder, search, pagination, selected message, and in-flight request state
 * from leaking into another split pane. The route-only Inbox keeps the
 * original default store for compatibility.
 */
export function inboxStoreForWorkspace(workspaceId?: string): InboxStoreHook {
  if (!workspaceId) return useInboxStore;
  const existing = workspaceStores.get(workspaceId);
  if (existing) return existing;
  const store = createInboxStore();
  workspaceStores.set(workspaceId, store);
  return store;
}

export function releaseInboxWorkspaceStore(workspaceId: string): void {
  workspaceStores.delete(workspaceId);
}
