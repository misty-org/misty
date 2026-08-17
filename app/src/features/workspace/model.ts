import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type WorkspaceSurfaceId =
  "space" | "browser" | "terminal" | "code" | "files" | "agents" | "extensions";

export type WorkspaceGroupKey = `space:${string}` | `tool:${WorkspaceSurfaceId}`;
export type WorkspaceInstancePolicy = "multiple" | "single";

export interface BrowserTabState {
  version: 1;
  url: string;
  faviconUrl: string | null;
}

export const blankBrowserUrl = "about:blank";

export function createBrowserTabState(url = blankBrowserUrl): BrowserTabState {
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
    typeof candidate.url === "string" && candidate.url.trim() ? candidate.url : blankBrowserUrl;
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
  id: string;
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  size: number;
}

export type WorkspaceLayoutPreset = "single" | "columns" | "rows" | "grid";

export interface WorkspaceLayout {
  preset: WorkspaceLayoutPreset;
  panes: WorkspacePane[];
  focusedPaneId: string;
  maximizedPaneId: string | null;
  preservedPreset: WorkspaceLayoutPreset | null;
}

export interface WorkspaceSnapshot {
  version: 1;
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

export const workspaceMaxPanes = 4;
