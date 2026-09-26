import type { MultiPanelTab, useMultiPanelStore } from "@/features/workspace";
import type { ExplorerLibrarySnapshot, MountedDevice, ProviderRemote } from "@/native/contracts";
import { Button } from "@/shared/ui";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { ExplorerLocationResult } from "../components/ExplorerToolbar";
import {
  explorerPathKey,
  explorerPathName,
  joinExplorerPath,
  normalizeExplorerPath,
} from "@/shared/lib/pathNormalization";
import { cx } from "./ExplorerDesktopShared";
import { explorerShellStyles } from "./ExplorerShellStyles";

export function ExplorerBottomBar(props: {
  sidebarVisible: boolean;
  previewVisible: boolean;
  onToggleSidebar: () => void;
  onTogglePreview: () => void;
}) {
  const SidebarIcon = props.sidebarVisible ? PanelLeftClose : PanelLeftOpen;
  const PreviewIcon = props.previewVisible ? PanelRightClose : PanelRightOpen;
  return (
    <footer className={explorerShellStyles.bottomBar}>
      <Button
        type="button"
        className={cx(
          explorerShellStyles.bottomButton,
          props.sidebarVisible && explorerShellStyles.bottomButtonSelected,
        )}
        title={props.sidebarVisible ? "Hide sidebar" : "Show sidebar"}
        onClick={props.onToggleSidebar}
      >
        <SidebarIcon size={15} />
      </Button>
      <div className={explorerShellStyles.bottomBarGroup}>
        <Button
          type="button"
          className={cx(
            explorerShellStyles.bottomButton,
            props.previewVisible && explorerShellStyles.bottomButtonSelected,
          )}
          title={props.previewVisible ? "Hide preview" : "Show preview"}
          onClick={props.onTogglePreview}
        >
          <PreviewIcon size={15} />
        </Button>
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
  androidLocal = false,
): ExplorerLocationResult[] {
  const results: ExplorerLocationResult[] = [];
  const seen = new Set<string>();
  const add = (label: string, path: string, badge: string) => {
    if (!path) return;
    const normalized = normalizedPath(path) || "/";
    const key = explorerPathKey(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    results.push({
      id: `${badge}:${key}`,
      label,
      path: normalized,
      subtitle: normalized,
      badge,
    });
  };

  if (androidLocal) {
    add("Local", homePath, "Quick");
    add("Recent", "misty://recent", "Quick");
    add("Starred", "misty://starred", "Quick");
    add("Trash", "misty://trash", "Quick");
  } else {
    add("Home", homePath, "Quick");
    add("Desktop", joinPath(homePath, "Desktop"), "Quick");
    add("Documents", joinPath(homePath, "Documents"), "Quick");
    add("Downloads", joinPath(homePath, "Downloads"), "Quick");
    add("Projects", joinPath(homePath, "Projects"), "Quick");
  }

  for (const path of pinnedPaths) {
    add(path.split("/").filter(Boolean).pop() || path, path, "Pinned");
  }
  for (const path of workspacePaths) {
    add(titleFromPath(path), path, "Tab");
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

export function mountedDevicesEqual(left: MountedDevice[], right: MountedDevice[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((device, index) => {
    const other = right[index];
    return (
      device.id === other.id &&
      device.name === other.name &&
      device.mountPath === other.mountPath &&
      device.fsType === other.fsType &&
      device.isRemovable === other.isRemovable &&
      device.totalBytes === other.totalBytes &&
      device.freeBytes === other.freeBytes
    );
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

export function resolvePreferredWorkspaceRoot(
  preferredWorkspaceRoot: string,
  fallbackHomePath: string,
): string {
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
  return normalizeExplorerPath(path);
}

function titleFromPath(path: string): string {
  if (path === "misty://local") return "Local";
  if (path === "misty://recent") return "Recent";
  if (path === "misty://starred") return "Starred";
  if (path === "misty://trash") return "Trash";
  return explorerPathName(path) || "Home";
}

function joinPath(...parts: string[]): string {
  const [first, ...rest] = parts;
  return joinExplorerPath(first, ...rest);
}

export function multiPanelWorkspaceNeedsSave(
  state: ReturnType<typeof useMultiPanelStore.getState>,
  previous: ReturnType<typeof useMultiPanelStore.getState>,
): boolean {
  return (
    state.tabs !== previous.tabs ||
    state.activeTabId !== previous.activeTabId ||
    state.closedPanes !== previous.closedPanes ||
    state.nextPaneIndex !== previous.nextPaneIndex ||
    state.nextTabIndex !== previous.nextTabIndex
  );
}
