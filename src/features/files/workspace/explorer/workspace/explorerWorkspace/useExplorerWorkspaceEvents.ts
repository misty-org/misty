import "@/features/files/workspace/native";
import { registerShortcutHandler, shortcutCommandsById } from "@/features/shortcuts";
import {
  dockLeaves,
  useMultiPanelStore,
  useWorkspaceStore,
  type MultiPanelStoreHook,
} from "@/features/workspace";
import { useEffect, type RefObject } from "react";
import type { NavigateFunction } from "react-router-dom";
import { useExplorerStore } from "../../store";
import { runExplorerCommand } from "../ExplorerCommands";
import { parsePluginTabPath } from "../ExplorerDesktopPlugins";
export function useLegacyPluginTabMigration(options: {
  homePath: string;
  workspacePathSignature: string;
  multiPanelStore?: MultiPanelStoreHook;
}): void {
  const { homePath, workspacePathSignature } = options;
  useEffect(() => {
    if (!homePath) return;
    const multi = (options.multiPanelStore ?? useMultiPanelStore).getState();
    const legacyTabs = multi.tabs.filter((tab) => parsePluginTabPath(tab.path));
    for (const tab of legacyTabs) {
      multi.updateActiveTabPath(tab.activePaneId, homePath, "Files");
      multi.setTabPanelVisibility(tab.id, {
        sidebarVisible: true,
        previewVisible: true,
      });
    }
  }, [homePath, options.multiPanelStore, workspacePathSignature]);
}
export function useOperationErrorNotification(
  operationError: string | null,
  pushNotification: (
    message: string,
    type?: "info" | "error" | "success",
    duration?: number,
  ) => void,
): void {
  useEffect(() => {
    if (!operationError) return;
    const message = useExplorerStore.getState().consumeOperationError();
    if (!message) return;
    const recoveredWorkspace =
      message.startsWith("Misty reset a damaged Explorer profile") ||
      message.startsWith("Profile could not be restored");
    pushNotification(message, recoveredWorkspace ? "info" : "error", 4500);
  }, [operationError, pushNotification]);
}
export function useExplorerKeyboardShortcuts(options: {
  active?: boolean;
  navigate: NavigateFunction;
  executableCommandIdsRef: RefObject<readonly string[]>;
  multiPanelStore?: MultiPanelStoreHook;
  workspaceId?: string;
}): void {
  const { navigate, executableCommandIdsRef } = options;
  useEffect(() => {
    const multiPanelStore = options.multiPanelStore ?? useMultiPanelStore;
    const enabled = () => {
      if (options.active === false) return false;
      const workspace = useWorkspaceStore.getState();
      const pane = dockLeaves(workspace.layout.root).find(
        (candidate) => candidate.id === workspace.layout.focusedPaneId,
      );
      const tab = pane?.tabs.find((candidate) => candidate.id === pane.activeTabId);
      return options.workspaceId ? tab?.id === options.workspaceId : tab?.surfaceId === "files";
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!enabled()) return;
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select, [contenteditable='true']") ?? false;
      const explorerState = useExplorerStore.getState();
      const paneId = multiPanelStore.getState().activePaneId;
      if (!paneId) return;
      if (event.key === "Escape") {
        explorerState.cancelInlineEdit();
        explorerState.closeContextMenu();
        return;
      }
      if (editing) return;
    };
    window.addEventListener("keydown", onKeyDown);
    const run = (commandId: string) => {
      const paneId = multiPanelStore.getState().activePaneId;
      if (!paneId) return;
      runExplorerCommand(commandId, paneId, navigate);
    };
    const commandIds = [...executableCommandIdsRef.current].filter((commandId) =>
      shortcutCommandsById.has(commandId),
    );
    const unregister = commandIds.map((commandId) =>
      registerShortcutHandler(commandId, () => run(commandId), enabled),
    );
    unregister.push(
      registerShortcutHandler(
        "navigation.back",
        () => {
          const paneId = multiPanelStore.getState().activePaneId;
          if (!paneId || !useExplorerStore.getState().panes[paneId]?.backHistory.length)
            return false;
          void useExplorerStore.getState().navigateBack(paneId);
          return true;
        },
        enabled,
        100,
      ),
      registerShortcutHandler(
        "navigation.forward",
        () => {
          const paneId = multiPanelStore.getState().activePaneId;
          if (!paneId || !useExplorerStore.getState().panes[paneId]?.forwardHistory.length)
            return false;
          void useExplorerStore.getState().navigateForward(paneId);
          return true;
        },
        enabled,
        100,
      ),
    );
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unregister.forEach((remove) => remove());
    };
  }, [
    executableCommandIdsRef,
    navigate,
    options.multiPanelStore,
    options.workspaceId,
    options.active,
  ]);
}
