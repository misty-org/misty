import { useMultiPanelStore } from "@/features/workspace";
import {
  clipboardSnapshot,
  explorerLibraryRecordLastOpened,
  explorerLibraryRecordRecent,
  explorerLibrarySnapshot,
  workspacesSnapshot,
} from "@/features/files/native";
import { errorText } from "@/shared/lib/format";
import type { ExplorerStore } from "../../model/interfaces/store/types";
import type { ExplorerGet, ExplorerSet } from "../../model/types/store/types";
import * as H from "../helpers";
import { explorerRuntime } from "../runtime";

export function createWorkspaceActions(set: ExplorerSet, get: ExplorerGet): Partial<ExplorerStore> {
  return {
    loadLibrary: async () => {
      try {
        set({ library: await explorerLibrarySnapshot() });
      } catch {
        // Library state is optional in browser/dev contexts and should not block Explorer startup.
      }
    },

    recordLibraryRecent: async (entry) => {
      try {
        set({ library: await explorerLibraryRecordRecent(H.libraryItemFromEntry(entry)) });
      } catch {
        // Best-effort parity with the native Recent library.
      }
    },

    recordLastOpenedPath: async (path) => {
      if (!path.trim()) return;
      if (get().library?.lastOpenedPath === path) return;
      try {
        set({ library: await explorerLibraryRecordLastOpened(path) });
      } catch {
        // Best-effort parity with the native last-opened path.
      }
    },

    initialize: async (homePath) => {
      const multi = useMultiPanelStore.getState();
      const shouldResetWorkspace = H.consumeExplorerWorkspaceResetFlag();
      if (explorerRuntime.initializationInFlight) return;
      if (!shouldResetWorkspace && (multi.tabs.length > 0 || get().initialized)) return;
      explorerRuntime.initializationInFlight = true;
      H.ensureDirectorySizeScheduler();
      void get().loadLibrary();
      try {
        const [workspaceDocument, processClipboard] = await Promise.all([
          workspacesSnapshot(),
          clipboardSnapshot(),
        ]);
        const restoredClipboard = H.explorerClipboardFromPayload(processClipboard.local);
        if (shouldResetWorkspace) {
          const resetDocument = H.defaultWorkspaceDocument();
          const workspace = H.defaultNativeWorkspace("workspace_0", "Profile 1", homePath, get());
          explorerRuntime.workspaceDocumentCache = await H.saveWorkspaceDocument({
            ...resetDocument,
            active_workspace_id: workspace.id,
            next_workspace_idx: 1,
            workspaces: [workspace],
          });
          set({
            ...H.workspaceMetadata(explorerRuntime.workspaceDocumentCache),
            clipboard: restoredClipboard,
            operationError: "Misty reset a damaged Explorer profile and opened a clean file pane.",
          });
        } else {
          explorerRuntime.workspaceDocumentCache = workspaceDocument;
        }
        const restored = H.restoreNativeWorkspace(explorerRuntime.workspaceDocumentCache, homePath);
        if (restored) {
          if (multi.hydrate(restored.multiPanel)) {
            const hydratedMulti = useMultiPanelStore.getState();
            set({
              ...H.workspaceMetadata(explorerRuntime.workspaceDocumentCache),
              panes: restored.panes,
              sidebarVisible: restored.workspace.sidebar_visible,
              previewVisible: restored.workspace.inspector_visible,
              sidebarWidth: H.clamp(restored.workspace.sidebar_width, 212, 380),
              previewWidth: H.clamp(restored.workspace.inspector_width, 240, 420),
              showHidden: restored.showHidden,
              paneShowHidden: restored.paneShowHidden,
              viewMode: restored.viewMode,
              paneViewModes: restored.paneViewModes,
              sort: restored.sort,
              paneSorts: restored.paneSorts,
              clipboard: restoredClipboard,
              initialized: true,
            });
            const activeTab =
              hydratedMulti.tabs.find((tab) => tab.id === hydratedMulti.activeTabId) ??
              hydratedMulti.tabs[0];
            await Promise.all(
              (activeTab?.panes ?? []).map((pane) => {
                const restoredPane = restored.panes[pane.id];
                return restoredPane?.listing &&
                  !H.isExplorerInternalTabPath(restoredPane.listing.path)
                  ? get().loadPane(pane.id, restoredPane.listing.path, "replace")
                  : Promise.resolve();
              }),
            );
            explorerRuntime.initializationInFlight = false;
            return;
          }
        }
        set(H.workspaceMetadata(explorerRuntime.workspaceDocumentCache));
      } catch (error) {
        set({ operationError: `Profile restore failed: ${errorText(error)}` });
      }
      multi.initialize(homePath, H.titleFromPath(homePath));
      const fallbackDocument =
        explorerRuntime.workspaceDocumentCache ?? H.defaultWorkspaceDocument();
      set({ ...H.workspaceMetadata(fallbackDocument), initialized: true });
      await get().loadPane(multi.activePaneId || "explorer-pane-0", homePath, "replace");
      explorerRuntime.initializationInFlight = false;
    },

    ensureWorkspace: async (workspaceId, title, homePath) => {
      if (!workspaceId.trim()) return;
      try {
        await get().initialize(homePath);
        await H.persistExplorerWorkspace();
        const document = explorerRuntime.workspaceDocumentCache ?? (await workspacesSnapshot());
        if (document.workspaces.some((workspace) => workspace.id === workspaceId)) {
          if (document.active_workspace_id !== workspaceId) {
            const nextDocument = await H.saveWorkspaceDocument({
              ...document,
              active_workspace_id: workspaceId,
            });
            await H.applyWorkspaceDocument(nextDocument, homePath);
          }
          return;
        }
        const workspace = H.defaultNativeWorkspace(
          workspaceId,
          title.trim() || "File Manager",
          homePath,
          get(),
        );
        const nextDocument = await H.saveWorkspaceDocument({
          ...document,
          schema_version: 1,
          active_workspace_id: workspaceId,
          next_workspace_idx: Math.max(
            document.next_workspace_idx,
            H.workspaceIndex(workspaceId) + 1,
          ),
          workspaces: [...document.workspaces, workspace],
        });
        await H.applyWorkspaceDocument(nextDocument, homePath);
      } catch (error) {
        set({ operationError: `Profile open failed: ${errorText(error)}` });
      }
    },

    selectWorkspace: async (workspaceId, homePath) => {
      if (!workspaceId || workspaceId === get().activeWorkspaceId) return;
      try {
        await H.persistExplorerWorkspace();
        let document = explorerRuntime.workspaceDocumentCache ?? (await workspacesSnapshot());
        if (!document.workspaces.some((workspace) => workspace.id === workspaceId)) return;
        document = await H.saveWorkspaceDocument({ ...document, active_workspace_id: workspaceId });
        await H.applyWorkspaceDocument(document, homePath);
      } catch (error) {
        set({ operationError: `Profile switch failed: ${errorText(error)}` });
      }
    },

    createWorkspace: async (title, homePath) => {
      const name = H.uniqueWorkspaceTitle(
        title.trim() || "Profile",
        explorerRuntime.workspaceDocumentCache?.workspaces ?? get().workspaceEntries,
      );
      try {
        await H.persistExplorerWorkspace();
        const document = explorerRuntime.workspaceDocumentCache ?? (await workspacesSnapshot());
        const nextIndex = H.nextWorkspaceIndex(document);
        const workspaceId = `workspace_${nextIndex}`;
        const workspace = H.defaultNativeWorkspace(workspaceId, name, homePath, get());
        const nextDocument = await H.saveWorkspaceDocument({
          ...document,
          schema_version: 1,
          active_workspace_id: workspaceId,
          next_workspace_idx: nextIndex + 1,
          workspaces: [...document.workspaces, workspace],
        });
        await H.applyWorkspaceDocument(nextDocument, homePath);
      } catch (error) {
        set({ operationError: `Profile create failed: ${errorText(error)}` });
      }
    },

    renameWorkspace: async (workspaceId, title) => {
      const trimmed = title.trim();
      if (!workspaceId || !trimmed) return;
      try {
        await H.persistExplorerWorkspace();
        const document = explorerRuntime.workspaceDocumentCache ?? (await workspacesSnapshot());
        const nextTitle = H.uniqueWorkspaceTitle(
          trimmed,
          document.workspaces.filter((workspace) => workspace.id !== workspaceId),
        );
        const workspaces = document.workspaces.map((workspace) =>
          workspace.id === workspaceId ? { ...workspace, title: nextTitle } : workspace,
        );
        const nextDocument = await H.saveWorkspaceDocument({ ...document, workspaces });
        set(H.workspaceMetadata(nextDocument));
      } catch (error) {
        set({ operationError: `Profile rename failed: ${errorText(error)}` });
      }
    },

    deleteWorkspace: async (workspaceId, homePath) => {
      if (!workspaceId) return;
      try {
        await H.persistExplorerWorkspace();
        const document = explorerRuntime.workspaceDocumentCache ?? (await workspacesSnapshot());
        if (document.workspaces.length <= 1) return;
        const deletedIndex = document.workspaces.findIndex(
          (workspace) => workspace.id === workspaceId,
        );
        if (deletedIndex < 0) return;
        const workspaces = document.workspaces.filter((workspace) => workspace.id !== workspaceId);
        const nextActive =
          document.active_workspace_id === workspaceId
            ? (workspaces[Math.max(0, deletedIndex - 1)] ?? workspaces[0])
            : (workspaces.find((workspace) => workspace.id === document.active_workspace_id) ??
              workspaces[0]);
        const nextDocument = await H.saveWorkspaceDocument({
          ...document,
          active_workspace_id: nextActive.id,
          workspaces,
        });
        if (document.active_workspace_id === workspaceId) {
          await H.applyWorkspaceDocument(nextDocument, homePath);
        } else {
          set(H.workspaceMetadata(nextDocument));
        }
      } catch (error) {
        set({ operationError: `Profile delete failed: ${errorText(error)}` });
      }
    },
  };
}
