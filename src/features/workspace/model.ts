import type { MistyTabGroup } from "./tabGroups";
import type { DockingLayout } from "@/features/app-shell/dockingLayout";
import { browserHomeUrl } from "./browserHome";
export * from "./browserSearchEngine";
import { blankBrowserUrl } from "./browserUrl";

export { blankBrowserUrl } from "./browserUrl";
export * from "./browserInternalUrl";
import { browserInternalPage, browserInternalPages } from "./browserInternalUrl";
export {
  browserHomeUrl,
  configureBrowserHomeUrl,
  defaultBrowserHomeUrl,
  normalizeBrowserHomeUrl,
} from "./browserHome";

export type WorkspaceSurfaceId =
  "space" | "browser" | "files" | "agents" | "scheduled" | "extensions";

export type WorkspaceGroupKey = `space:${string}` | `tool:${WorkspaceSurfaceId}` | `app:${string}`;
export type WorkspaceInstancePolicy = "multiple" | "single";
export type WorkspaceScopeKey = "global" | `space:${string}`;
export type DockMountPolicy = "keep-alive" | "suspend" | "unmount";
export type DockSplitDirection = "left" | "right" | "up" | "down";
export type DockDropZone = "center" | DockSplitDirection;

export interface BrowserViewState {
  version: 1;
  url: string;
  faviconUrl: string | null;
  agentOwned?: boolean;
  /** Native browser profile identity; preserved across navigation. */
  profileId?: string;
  /** Saved website used to open this tab, independent of its current URL. */
  bookmarkId?: string;
  /** A private tab: throwaway website data, no history, never saved or synced. */
  private?: true;
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
    profileId:
      typeof candidate.profileId === "string" && /^[a-f0-9]{64}$/.test(candidate.profileId)
        ? candidate.profileId
        : undefined,
    bookmarkId:
      typeof bookmarkId === "string" && /^[A-Za-z0-9:_.-]{1,200}$/.test(bookmarkId)
        ? bookmarkId
        : undefined,
    private: candidate.private === true || undefined,
  };
}

export function isPlaceholderBrowserTitle(title?: string): boolean {
  if (!title) return true;
  const normalized = title.trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized === "loading" ||
    normalized.startsWith("loading...") ||
    normalized.startsWith("loading…") ||
    normalized.startsWith("loading -") ||
    normalized.startsWith("loading —") ||
    normalized === "please wait" ||
    normalized.startsWith("please wait...") ||
    normalized.startsWith("please wait…") ||
    normalized === "untitled" ||
    normalized === "untitled document" ||
    normalized === "about:blank"
  );
}

export function sanitizeBrowserTitle(title?: string, url?: string): string {
  const trimmed = title?.trim();
  if (trimmed && !isPlaceholderBrowserTitle(trimmed)) {
    return trimmed;
  }
  return url ? browserViewTitle(url) : "New Tab";
}

export function browserViewTitle(url: string): string {
  if (url === blankBrowserUrl) return "New Tab";
  const internal = browserInternalPage(url);
  if (internal) return browserInternalPages[internal].title;
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
  /** Active tab projection, retained for pane/runtime consumers. */
  root: WorkspaceDockNode;
  focusedPaneId: string;
  tabs?: WorkspaceTab[];
  activeTabId?: string;
}

/** A window tab owns a split tree; each leaf contains one app view. */
export interface WorkspaceTab {
  /** Chrome-style grouping of visible layout tabs, independent of pane identities. */
  tabGroupId?: string;
  id: string;
  /** Legacy native aliases are resolved after account preferences load. */
  legacyNameKeys?: string[];
  title?: string;
  root: WorkspaceDockNode;
  focusedPaneId: string;
}

export interface WorkspaceWindow {
  dockingLayout?: DockingLayout;
  id: string;
  title: string;
  layout: WorkspaceLayout;
  createdAt: number;
  lastFocusedAt: number;
}

export interface WorkspaceSnapshot {
  tabGroups?: MistyTabGroup[];
  version: 2 | 3 | 4;
  accountId: string;
  deviceId: string;
  savedAt: number;
  layout: WorkspaceLayout;
  lastUsedViewByGroup: Partial<Record<WorkspaceGroupKey, string>>;
  windows?: WorkspaceWindow[];
  activeWindowId?: string;
}

export interface OpenWorkspaceSurfaceRequest {
  surfaceId: WorkspaceSurfaceId;
  groupKey: WorkspaceGroupKey;
  /** Layout scope is separate from tab identity for tools hosted by a Space. */
  scopeKey?: WorkspaceScopeKey;
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
export const maxWorkspacePanels = 4;
