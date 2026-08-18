import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type WorkspaceSurfaceId =
  | "home"
  | "space"
  | "browser"
  | "terminal"
  | "code"
  | "files"
  | "transfers"
  | "agents"
  | "extensions";

export type WorkspaceGroupKey = `space:${string}` | `tool:${WorkspaceSurfaceId}`;
export type WorkspaceInstancePolicy = "multiple" | "single";
export type WorkspaceScopeKey = "global" | `space:${string}`;
export type DockMountPolicy = "keep-alive" | "suspend" | "unmount";
export type DockSplitDirection = "left" | "right" | "up" | "down";
export type DockDropZone = "center" | DockSplitDirection;

export interface BrowserTabState {
  version: 1;
  url: string;
  faviconUrl: string | null;
}

export const blankBrowserUrl = "about:blank";
/** Where a browser tab starts when nothing else asked for a URL. */
export const defaultBrowserHomeUrl = "https://www.google.com";

export function createBrowserTabState(url = defaultBrowserHomeUrl): BrowserTabState {
  return {
    version: 1,
    url,
    faviconUrl: browserFaviconUrl(url),
  };
}

export function parseBrowserTabState(value: unknown): BrowserTabState {
  if (!value || typeof value !== "object") return createBrowserTabState();
  const candidate = value as Partial<BrowserTabState>;
  const url =
    typeof candidate.url === "string" && candidate.url.trim()
      ? candidate.url
      : defaultBrowserHomeUrl;
  return {
    version: 1,
    url,
    faviconUrl:
      typeof candidate.faviconUrl === "string" && candidate.faviconUrl
        ? candidate.faviconUrl
        : browserFaviconUrl(url),
  };
}

export function browserTabTitle(url: string): string {
  if (url === blankBrowserUrl) return "New Tab";
  try {
    const parsed = new URL(url);
    const query = parsed.searchParams.get("q");
    if (query) return query;
    return parsed.hostname.replace(/^www\./, "") || "New Tab";
  } catch {
    return "New Tab";
  }
}

function browserFaviconUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? `${url.origin}/favicon.ico`
      : null;
  } catch {
    return null;
  }
}

export interface WorkspaceSurfaceDescriptor<TState = unknown> {
  id: WorkspaceSurfaceId;
  title: string;
  icon: LucideIcon;
  instancePolicy: WorkspaceInstancePolicy;
  sidebar?: (state: TState) => ReactNode;
  content: (state: TState) => ReactNode;
  serialize: (state: TState) => unknown;
  restore: (snapshot: unknown) => TState;
}

export interface DockWidgetDescriptor<TState = unknown> {
  kind: WorkspaceSurfaceId;
  instancePolicy: "singleton" | "per-space" | "multiple";
  mountPolicy: DockMountPolicy;
  minimumSize: { width: number; height: number };
  create: () => TState;
  serialize: (state: TState) => unknown;
  restore: (snapshot: unknown) => TState;
  dispose?: (state: TState) => void;
}

export interface WorkspaceTab {
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
  tabs: WorkspaceTab[];
  activeTabId: string | null;
}

export interface WorkspaceSplit {
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
}

export interface WorkspaceSnapshot {
  version: 2;
  accountId: string;
  deviceId: string;
  savedAt: number;
  layout: WorkspaceLayout;
  lastUsedTabByGroup: Partial<Record<WorkspaceGroupKey, string>>;
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
  /** Keep an existing tab aligned with navigation driven by the app route. */
  syncExistingRoute?: boolean;
  paneId?: string;
}

export const workspaceDefaultMinimumSize = { width: 280, height: 180 } as const;
