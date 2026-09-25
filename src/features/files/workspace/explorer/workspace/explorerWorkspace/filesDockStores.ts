import {
  createMultiPanelStore,
  destroyMultiPanelStore,
  useMultiPanelStore,
  type MultiPanelStoreHook,
} from "@/features/workspace";

const storesByWorkspaceId = new Map<string, MultiPanelStoreHook>();

export function filesMultiPanelStore(workspaceId?: string): MultiPanelStoreHook {
  if (!workspaceId) return useMultiPanelStore;
  const existing = storesByWorkspaceId.get(workspaceId);
  if (existing) return existing;
  const store = createMultiPanelStore({
    idPrefix: `files-${workspaceId}`,
    defaultTitle: "Files",
  });
  storesByWorkspaceId.set(workspaceId, store);
  return store;
}

export function releaseFilesMultiPanelStore(workspaceId: string): void {
  const store = storesByWorkspaceId.get(workspaceId);
  if (!store) return;
  storesByWorkspaceId.delete(workspaceId);
  destroyMultiPanelStore(store);
}
