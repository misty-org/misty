import type { DockingLayout } from "@/app/shell/dockingLayout";
import { browserHomeUrl } from "../addresses/browserHome";

export { blankBrowserUrl } from "../addresses/browserUrl";
export { browserHomeUrl } from "../addresses/browserHome";

export type WorkspaceSurfaceId = "space" | "agents";

export type WorkspaceGroupKey = `space:${string}` | `tool:${WorkspaceSurfaceId}` | `app:${string}`;
type WorkspaceInstancePolicy = "multiple" | "single";
type DockMountPolicy = "keep-alive" | "suspend" | "unmount";
export type DockSplitDirection = "left" | "right" | "up" | "down";
export type DockDropZone = "center" | DockSplitDirection;

export interface BrowserViewState {
  version: 1;
  url: string;
  faviconUrl: string | null;
  agentOwned?: boolean;
  /** Saved website used to open this tab, independent of its current URL. */
  bookmarkId?: string;
}

export function createBrowserViewState(url = browserHomeUrl()): BrowserViewState {
  return {
    version: 1,
    url,
    faviconUrl: browserFaviconUrl(url),
  };
}

export function parseBrowserViewState(value: unknown): BrowserViewState {
  if (!value || typeof value !== "object") return createBrowserViewState();
  const candidate = value as Partial<BrowserViewState> & { websiteId?: unknown };
  const bookmarkId = candidate.bookmarkId ?? candidate.websiteId;
  const url =
    typeof candidate.url === "string" && candidate.url.trim() ? candidate.url : browserHomeUrl();
  return {
    version: 1,
    url,
    faviconUrl:
      typeof candidate.faviconUrl === "string" && candidate.faviconUrl
        ? candidate.faviconUrl
        : browserFaviconUrl(url),
    agentOwned: candidate.agentOwned === true || undefined,
    bookmarkId:
      typeof bookmarkId === "string" && /^[A-Za-z0-9:_.-]{1,200}$/.test(bookmarkId)
        ? bookmarkId
        : undefined,
  };
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

export interface WorkspaceView {
  /** An unused new tab or split can take the next selected destination. */
  placeholder?: boolean;
  /** Stable identity of this pane’s app group, independent of its label. */
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
  /** Active tab projection, retained for pane/runtime consumers. */
  root: WorkspaceDockNode;
  focusedPaneId: string;
  tabs?: WorkspaceTab[];
  activeTabId?: string;
}

/** A window tab owns a split tree; each leaf contains one app view. */
export interface WorkspaceTab {
  id: string;
  /** Legacy native aliases are resolved after account preferences load. */
  legacyNameKeys?: string[];
  title?: string;
  root: WorkspaceDockNode;
  focusedPaneId: string;
}

/** An OS window of one profile (window → tab → pane → view). */
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
  /** Keep an existing tab aligned with navigation driven by the app route. */
  syncExistingRoute?: boolean;
  paneId?: string;
}
export const maxWorkspacePanes = 4;
