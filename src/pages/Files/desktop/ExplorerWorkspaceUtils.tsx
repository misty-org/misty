import { PanelLeft, PanelRight, Puzzle } from "lucide-react";
import type { ExplorerLibrarySnapshot, MountedDevice, PluginCommandEntry, PluginPanelEntry, ProviderRemote } from "../../../api/types";
import type { MultiPanelTab } from "../../../shared/multipanel/types";
import { useMultiPanelStore } from "../../../shared/multipanel/useMultiPanelStore";
import type { ExplorerLocationResult } from "../components/ExplorerToolbar";
import { cx } from "./ExplorerDesktopShared";
import { explorerShellStyles } from "./ExplorerShellStyles";

export function ExplorerBottomBar(props: {
  sidebarVisible: boolean;
  previewVisible: boolean;
  extensionsVisible: boolean;
  onToggleSidebar: () => void;
  onTogglePreview: () => void;
  onToggleExtensions: () => void;
}) {
  return (
    <footer className={explorerShellStyles.bottomBar}>
      <button
        type="button"
        className={cx(explorerShellStyles.bottomButton, props.sidebarVisible && explorerShellStyles.bottomButtonSelected)}
        title={props.sidebarVisible ? "Hide sidebar" : "Show sidebar"}
        onClick={props.onToggleSidebar}
      >
        <PanelLeft size={15} />
      </button>
      <div className={explorerShellStyles.bottomBarGroup}>
        <button
          type="button"
          className={cx(explorerShellStyles.bottomButton, props.previewVisible && explorerShellStyles.bottomButtonSelected)}
          title={props.previewVisible ? "Hide preview" : "Show preview"}
          onClick={props.onTogglePreview}
        >
          <PanelRight size={15} />
        </button>
        <button
          type="button"
          className={cx(explorerShellStyles.bottomButton, props.extensionsVisible && explorerShellStyles.bottomButtonSelected)}
          title={props.extensionsVisible ? "Hide extensions" : "Show extensions"}
          onClick={props.onToggleExtensions}
        >
          <Puzzle size={15} />
        </button>
      </div>
    </footer>
  );
}

export function buildExplorerLocationResults(
  homePath: string,
  mountRoot: string,
  pinnedPaths: string[],
  remotes: ProviderRemote[],
  library: ExplorerLibrarySnapshot | null,
  workspacePaths: string[],
): ExplorerLocationResult[] {
  const results: ExplorerLocationResult[] = [];
  const seen = new Set<string>();
  const add = (label: string, path: string, badge: string) => {
    if (!path) return;
    const key = normalizedPath(path) || "/";
    if (seen.has(key)) return;
    seen.add(key);
    results.push({
      id: `${badge}:${key}`,
      label,
      path,
      subtitle: path,
      badge,
    });
  };

  add("Home", homePath, "Quick");
  add("Desktop", joinPath(homePath, "Desktop"), "Quick");
  add("Documents", joinPath(homePath, "Documents"), "Quick");
  add("Downloads", joinPath(homePath, "Downloads"), "Quick");
  add("Projects", joinPath(homePath, "Projects"), "Quick");

  for (const path of pinnedPaths) {
    add(path.split("/").filter(Boolean).pop() || path, path, "Pinned");
  }
  for (const path of workspacePaths) {
    add(titleFromPath(path), path, "Workspace");
  }
  for (const item of library?.starredFiles ?? []) {
    add(item.name || titleFromPath(item.path), item.path, "Starred");
  }
  for (const item of library?.recentFiles ?? []) {
    add(item.name || titleFromPath(item.path), item.path, "Recent");
  }
  for (const remote of remotes) {
    add(remote.name, joinPath(mountRoot, remote.name), remote.type);
  }

  return results;
}

export function pluginCommandsEqual(left: PluginCommandEntry[], right: PluginCommandEntry[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((command, index) => {
    const other = right[index];
    return command.id === other.id
      && command.label === other.label
      && command.hint === other.hint
      && command.pluginId === other.pluginId
      && command.pluginName === other.pluginName
      && command.defaultShortcut === other.defaultShortcut
      && command.source === other.source
      && command.actionKind === other.actionKind
      && command.launcherOpenMode === other.launcherOpenMode
      && command.requiresSelectedFile === other.requiresSelectedFile
      && command.pluginDir === other.pluginDir
      && command.manifestPath === other.manifestPath
      && command.libraryPath === other.libraryPath;
  });
}

export function pluginPanelsEqual(left: PluginPanelEntry[], right: PluginPanelEntry[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((panel, index) => {
    const other = right[index];
    return panel.id === other.id
      && panel.title === other.title
      && panel.pluginId === other.pluginId
      && panel.pluginName === other.pluginName
      && panel.windowType === other.windowType
      && panel.defaultWidth === other.defaultWidth
      && panel.defaultHeight === other.defaultHeight
      && panel.pluginDir === other.pluginDir
      && panel.manifestPath === other.manifestPath
      && panel.libraryPath === other.libraryPath
      && panel.launcherViews.join("\n") === other.launcherViews.join("\n");
  });
}

export function mountedDevicesEqual(left: MountedDevice[], right: MountedDevice[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((device, index) => {
    const other = right[index];
    return device.id === other.id
      && device.name === other.name
      && device.mountPath === other.mountPath
      && device.fsType === other.fsType
      && device.isRemovable === other.isRemovable
      && device.totalBytes === other.totalBytes
      && device.freeBytes === other.freeBytes;
  });
}

export function workspaceSearchPaths(tabs: MultiPanelTab[]): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const add = (path: string) => {
    const key = normalizedPath(path) || "/";
    if (!key || seen.has(key)) return;
    seen.add(key);
    paths.push(path);
  };
  for (const tab of tabs) {
    add(tab.path);
    for (const pane of tab.panes) add(pane.path);
  }
  return paths;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function resolveMountRoot(homePath: string, configuredPath: string): string {
  if (configuredPath.startsWith("/")) return configuredPath.replace(/\/+$/, "");
  return `${homePath.replace(/\/+$/, "")}/${configuredPath.replace(/^\/+|\/+$/g, "")}`;
}

export function resolvePreferredWorkspaceRoot(preferredWorkspaceRoot: string, fallbackHomePath: string): string {
  const trimmed = preferredWorkspaceRoot.trim();
  if (!trimmed || trimmed === "~") return fallbackHomePath;
  if (trimmed.startsWith("~/")) return joinPath(fallbackHomePath, trimmed.slice(2));
  if (isAbsolutePath(trimmed)) return normalizedPath(trimmed) || fallbackHomePath;
  return joinPath(fallbackHomePath, trimmed);
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function normalizedPath(path: string): string {
  return path.replace(/\/+$/, "");
}

function titleFromPath(path: string): string {
  if (path === "misty://recent") return "Recent";
  if (path === "misty://starred") return "Starred";
  if (path === "misty://trash") return "Trash";
  const clean = normalizedPath(path);
  return clean.split("/").filter(Boolean).pop() || clean || "Home";
}

function joinPath(...parts: string[]): string {
  const [first, ...rest] = parts;
  return [first.replace(/\/+$/, ""), ...rest.map((part) => part.replace(/^\/+|\/+$/g, ""))].join("/");
}

export function multiPanelWorkspaceNeedsSave(
  state: ReturnType<typeof useMultiPanelStore.getState>,
  previous: ReturnType<typeof useMultiPanelStore.getState>,
): boolean {
  return state.tabs !== previous.tabs
    || state.activeTabId !== previous.activeTabId
    || state.closedPanes !== previous.closedPanes
    || state.nextPaneIndex !== previous.nextPaneIndex
    || state.nextTabIndex !== previous.nextTabIndex;
}
