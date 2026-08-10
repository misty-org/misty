import type { MultiPanelTab } from "@/features/workspace";
import { useMultiPanelStore } from "@/features/workspace";
import {
  androidGrantLocalFolder,
  androidOpenAllFilesAccessSettings,
} from "@/features/files/native";
import type { PluginCommandEntry } from "@/native/contracts";
import { errorText } from "@/shared/lib/format";
import type { ShortcutMap } from "@/shared/lib/shortcuts";
import { useCallback, useEffect, type RefObject } from "react";
import type { NavigateFunction } from "react-router-dom";
import type { AndroidLocalGrantRequest } from "../../model/interfaces/components/ExplorerSidebar";
import { useExplorerStore } from "../../store";
import { runExplorerCommand, runPluginCommand, shortcutCommandForEvent } from "../ExplorerCommands";
import { parsePluginTabPath } from "../ExplorerDesktopPlugins";

export function useLegacyPluginTabMigration(options: {
  extensionsEnabled: boolean;
  homePath: string;
  navigate: NavigateFunction;
  workspacePathSignature: string;
}): void {
  const { extensionsEnabled, homePath, navigate, workspacePathSignature } = options;
  useEffect(() => {
    if (!extensionsEnabled) return;
    const multi = useMultiPanelStore.getState();
    const legacyTabs = multi.tabs
      .map((tab) => ({ tab, plugin: parsePluginTabPath(tab.path) }))
      .filter(
        (
          entry,
        ): entry is {
          tab: MultiPanelTab;
          plugin: NonNullable<ReturnType<typeof parsePluginTabPath>>;
        } => Boolean(entry.plugin),
      );
    if (legacyTabs.length === 0) return;
    const activeLegacy =
      legacyTabs.find(({ tab }) => tab.id === multi.activeTabId) ?? legacyTabs[0];
    for (const { tab } of legacyTabs) {
      multi.updateActiveTabPath(tab.activePaneId, homePath, "Files");
      multi.setTabPanelVisibility(tab.id, { sidebarVisible: true, previewVisible: true });
    }
    const params = new URLSearchParams({ extension: activeLegacy.plugin.pluginId });
    if (activeLegacy.plugin.selectedPath) params.set("selected", activeLegacy.plugin.selectedPath);
    navigate(`/files?${params.toString()}`, { replace: true });
  }, [extensionsEnabled, homePath, navigate, workspacePathSignature]);
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
      message.startsWith("Misty reset a damaged Explorer layout") ||
      message.startsWith("Workspace layout could not be restored");
    pushNotification(message, recoveredWorkspace ? "info" : "error", 4500);
  }, [operationError, pushNotification]);
}

export function useExplorerKeyboardShortcuts(options: {
  navigate: NavigateFunction;
  shortcutMapRef: RefObject<ShortcutMap>;
  executableCommandIdsRef: RefObject<readonly string[]>;
  pluginCommandsRef: RefObject<PluginCommandEntry[]>;
}): void {
  const { navigate, shortcutMapRef, executableCommandIdsRef, pluginCommandsRef } = options;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select, [contenteditable='true']") ?? false;
      const explorerState = useExplorerStore.getState();
      const paneId = useMultiPanelStore.getState().activePaneId;
      if (!paneId) return;
      if (event.key === "Escape") {
        explorerState.cancelInlineEdit();
        explorerState.closeContextMenu();
        return;
      }
      if (editing) return;

      const commandId = shortcutCommandForEvent(
        event,
        shortcutMapRef.current,
        executableCommandIdsRef.current,
      );
      if (commandId) {
        event.preventDefault();
        const pluginCommand = pluginCommandsRef.current.find((command) => command.id === commandId);
        if (pluginCommand) void runPluginCommand(pluginCommand, paneId, navigate);
        else runExplorerCommand(commandId, paneId, navigate);
      } else if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        void explorerState.navigateBack(paneId);
      } else if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        void explorerState.navigateForward(paneId);
      } else if (event.metaKey && event.key === "Backspace") {
        event.preventDefault();
        void explorerState.deleteSelected(paneId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [executableCommandIdsRef, navigate, pluginCommandsRef, shortcutMapRef]);
}

export function useAndroidLocalFolderGrant(options: {
  homePath: string;
  refreshAndroidAllFilesAccess: () => Promise<{
    granted: boolean;
    storageRoot?: string | null;
  } | null>;
  refreshAndroidGrantedFolders: () => Promise<unknown>;
}): (request?: AndroidLocalGrantRequest) => void {
  const { homePath, refreshAndroidAllFilesAccess, refreshAndroidGrantedFolders } = options;
  return useCallback(
    (request?: AndroidLocalGrantRequest) => {
      void (async () => {
        const currentStatus = await refreshAndroidAllFilesAccess();
        if (!currentStatus?.granted) {
          try {
            await androidOpenAllFilesAccessSettings();
            useExplorerStore
              .getState()
              .pushNotification(
                "Enable All files access for Misty, then return to continue browsing local files.",
                "info",
              );
          } catch (error) {
            useExplorerStore
              .getState()
              .pushNotification(
                `Could not open Android storage settings: ${errorText(error)}`,
                "error",
              );
          }
          return;
        }
        const storageRoot = currentStatus.storageRoot?.replace(/\/+$/, "");
        if (storageRoot) {
          const paneId = useMultiPanelStore.getState().activePaneId;
          const targetPath = request?.initialDirectory
            ? `${storageRoot}/${request.initialDirectory.replace(/^\/+|\/+$/g, "")}`
            : storageRoot;
          if (paneId) await useExplorerStore.getState().navigatePane(paneId, targetPath);
          return;
        }
        if (request?.grantedPath) {
          const paneId = useMultiPanelStore.getState().activePaneId;
          if (paneId) await useExplorerStore.getState().navigatePane(paneId, request.grantedPath);
          return;
        }
        try {
          const folder = await androidGrantLocalFolder({
            initialDirectory: request?.initialDirectory,
          });
          await refreshAndroidGrantedFolders();
          const paneId = useMultiPanelStore.getState().activePaneId;
          if (paneId)
            await useExplorerStore.getState().navigatePane(paneId, folder.path || homePath);
          useExplorerStore
            .getState()
            .pushNotification(`Added local folder ${folder.name}`, "success");
        } catch (error) {
          const message = errorText(error);
          if (!/cancel/i.test(message)) {
            useExplorerStore
              .getState()
              .pushNotification(`Could not add local folder: ${message}`, "error");
          }
        }
      })();
    },
    [homePath, refreshAndroidAllFilesAccess, refreshAndroidGrantedFolders],
  );
}
