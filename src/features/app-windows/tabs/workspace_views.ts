import type { TabGroupColor } from "@misty/ui";
import type { DockingLayout } from "@/app/shell/docking_layout";

export { browserHomeUrl } from "../addresses/browser_home";

export type WorkspaceSurfaceId = "space" | "agents" | "direct" | "browser";

export type WorkspaceGroupKey = `space:${string}` | `tool:${WorkspaceSurfaceId}` | `app:${string}`;
type WorkspaceInstancePolicy = "multiple" | "single";
type DockMountPolicy = "keep-alive" | "suspend" | "unmount";
export type DockSplitDirection = "left" | "right" | "up" | "down";
export type DockDropZone = "center" | DockSplitDirection;

export function browserFaviconUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? `${url.origin}/favicon.ico`
      : null;
  } catch {
    return null;
  }
}

export interface DockWidgetDescriptor<TState = unknown> {
  kind: WorkspaceSurfaceId;
  instancePolicy: "singleton" | "per-space" | "multiple";
  mountPolicy: DockMountPolicy;
  minimumSize: { width: number; height: number };
  contentWidth: number;
  create: () => TState;
  serialize: (state: TState) => unknown;
  restore: (snapshot: unknown) => TState;
  dispose?: (state: TState) => void;
}

export interface WorkspaceView {
  placeholder?: boolean;
  fresh?: boolean;
  groupInstanceId?: string;
  id: string;
  surfaceId: WorkspaceSurfaceId;
  groupKey: WorkspaceGroupKey;
  instanceKey: string;
  title: string;
  route: string;
  sidebarVisible: boolean;
  state: unknown;
  createdAt: number;
  lastFocusedAt: number;
}

export interface WorkspacePane {
  type: "leaf";
  id: string;
  views: WorkspaceView[];
  activeViewId: string | null;
  history?: { entries: WorkspaceView[]; index: number };
}

interface WorkspaceSplit {
  type: "split";
  id: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  first: WorkspaceDockNode;
  second: WorkspaceDockNode;
}

export type WorkspaceDockNode = WorkspacePane | WorkspaceSplit;

export interface WorkspaceLayout {
  root: WorkspaceDockNode;
  focusedPaneId: string;
  tabs?: WorkspaceTab[];
  activeTabId?: string;
  groups?: WorkspaceTabGroup[];
}

export interface WorkspaceTab {
  id: string;
  title?: string;
  root: WorkspaceDockNode;
  focusedPaneId: string;
  group?: string;
}

export interface WorkspaceTabGroup {
  id: string;
  title: string;
  color: TabGroupColor;
  collapsed?: boolean;
}

export interface WorkspaceWindow {
  dockingLayout?: DockingLayout;
  id: string;
  title: string;
  layout: WorkspaceLayout;
  createdAt: number;
  lastFocusedAt: number;
}

export interface OpenWorkspaceSurfaceRequest {
  surfaceId: WorkspaceSurfaceId;
  groupKey: WorkspaceGroupKey;
  title: string;
  route: string;
  instanceKey?: string;
  state?: unknown;
  sidebarVisible?: boolean;
  instancePolicy?: WorkspaceInstancePolicy;
  forceNew?: boolean;
  syncExistingRoute?: boolean;
  paneId?: string;
}
export const maxWorkspacePanes = 4;
