import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { browserHomeUrl } from "./browserHome";
export * from "./browserSearchEngine";
import { blankBrowserUrl } from "./browserUrl";

export { blankBrowserUrl } from "./browserUrl";
export {
  browserHomeUrl,
  configureBrowserHomeUrl,
  defaultBrowserHomeUrl,
  normalizeBrowserHomeUrl,
} from "./browserHome";

export type WorkspaceSurfaceId =
  | "home"
  | "inbox"
  | "space"
  | "browser"
  | "terminal"
  | "code"
  | "files"
  | "transfers"
  | "agents"
  | "extension"
  | "marketplace";

export type WorkspaceGroupKey = `space:${string}` | `tool:${WorkspaceSurfaceId}` | `app:${string}`;
export type WorkspaceInstancePolicy = "multiple" | "single";
export type WorkspaceScopeKey = "global" | `space:${string}`;
export type DockMountPolicy = "keep-alive" | "suspend" | "unmount";
export type DockSplitDirection = "left" | "right" | "up" | "down";
export type DockDropZone = "center" | DockSplitDirection;

export interface BrowserTabState {
  version: 1;
  url: string;
  faviconUrl: string | null;
  agentOwned?: boolean;
}

export type CodeMultibufferKind =
  "search" | "references" | "diagnostics" | "rename" | "code-action";

export interface CodeLocationSpec {
  path: string;
  line: number;
  character: number;
}

export type CodeMultibufferSpec =
  | {
      id: string;
      kind: "search";
      title: string;
      query: string;
      caseSensitive: boolean;
    }
  | {
      id: string;
      kind: "references";
      title: string;
      origin: CodeLocationSpec;
    }
  | {
      id: string;
      kind: "diagnostics";
      title: string;
    }
  | {
      id: string;
      kind: "rename" | "code-action";
      title: string;
      origin: CodeLocationSpec;
      expired: true;
    };

export type CodeViewportState =
  | { kind: "file"; activeFilePath: string | null }
  | { kind: "multibuffer"; spec: CodeMultibufferSpec };

export interface CodeTabState {
  version: 2;
  rootPath: string | null;
  viewport: CodeViewportState;
  explorerWidth: number;
}

export function createCodeTabState(
  initial: Partial<Omit<CodeTabState, "version" | "viewport">> & {
    viewport?: CodeViewportState;
    /** Accepted while callers migrate from version 1. */
    activeFilePath?: string | null;
  } = {},
): CodeTabState {
  return {
    version: 2,
    rootPath: initial.rootPath ?? null,
    viewport: sanitizeCodeViewport(
      initial.viewport ?? { kind: "file", activeFilePath: initial.activeFilePath ?? null },
    ),
    explorerWidth: clampCodeExplorerWidth(initial.explorerWidth),
  };
}

export function parseCodeTabState(value: unknown): CodeTabState {
  if (!value || typeof value !== "object") return createCodeTabState();
  const candidate = value as Partial<CodeTabState> & {
    activeFilePath?: unknown;
    version?: unknown;
  };
  return createCodeTabState({
    rootPath:
      typeof candidate.rootPath === "string" && candidate.rootPath.trim()
        ? candidate.rootPath
        : null,
    viewport:
      candidate.version === 2
        ? sanitizeCodeViewport(candidate.viewport)
        : {
            kind: "file",
            activeFilePath:
              typeof candidate.activeFilePath === "string" && candidate.activeFilePath.trim()
                ? candidate.activeFilePath
                : null,
          },
    explorerWidth: candidate.explorerWidth,
  });
}

export function codeTabActiveFilePath(state: CodeTabState): string | null {
  return state.viewport.kind === "file" ? state.viewport.activeFilePath : null;
}

function sanitizeCodeViewport(value: unknown): CodeViewportState {
  if (!value || typeof value !== "object") return { kind: "file", activeFilePath: null };
  const candidate = value as { kind?: unknown; activeFilePath?: unknown; spec?: unknown };
  if (candidate.kind === "multibuffer") {
    const spec = sanitizeMultibufferSpec(candidate.spec);
    if (spec) return { kind: "multibuffer", spec };
  }
  return {
    kind: "file",
    activeFilePath:
      typeof candidate.activeFilePath === "string" && candidate.activeFilePath.trim()
        ? candidate.activeFilePath
        : null,
  };
}

function sanitizeMultibufferSpec(value: unknown): CodeMultibufferSpec | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === "string" && candidate.id ? candidate.id : "code-result";
  const title =
    typeof candidate.title === "string" && candidate.title ? candidate.title : "Results";
  if (candidate.kind === "search" && typeof candidate.query === "string") {
    return {
      id,
      kind: "search",
      title,
      query: candidate.query,
      caseSensitive: candidate.caseSensitive === true,
    };
  }
  if (candidate.kind === "diagnostics") return { id, kind: "diagnostics", title };
  const origin = sanitizeCodeLocation(candidate.origin);
  if (candidate.kind === "references" && origin) return { id, kind: "references", title, origin };
  if ((candidate.kind === "rename" || candidate.kind === "code-action") && origin) {
    return { id, kind: candidate.kind, title, origin, expired: true };
  }
  return null;
}

function sanitizeCodeLocation(value: unknown): CodeLocationSpec | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CodeLocationSpec>;
  if (typeof candidate.path !== "string" || !candidate.path) return null;
  return {
    path: candidate.path,
    line: typeof candidate.line === "number" && candidate.line >= 0 ? candidate.line : 0,
    character:
      typeof candidate.character === "number" && candidate.character >= 0 ? candidate.character : 0,
  };
}

function clampCodeExplorerWidth(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(42, Math.max(14, value))
    : 22;
}

export function createBrowserTabState(url = browserHomeUrl()): BrowserTabState {
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
    typeof candidate.url === "string" && candidate.url.trim() ? candidate.url : browserHomeUrl();
  return {
    version: 1,
    url,
    faviconUrl:
      typeof candidate.faviconUrl === "string" && candidate.faviconUrl
        ? candidate.faviconUrl
        : browserFaviconUrl(url),
    agentOwned: candidate.agentOwned === true || undefined,
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
  return url ? browserTabTitle(url) : "New Tab";
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

export interface WorkspaceVirtualWindow {
  id: string;
  title: string;
  layout: WorkspaceLayout;
  createdAt: number;
  lastFocusedAt: number;
}

export interface WorkspaceSnapshot {
  version: 2 | 3;
  accountId: string;
  deviceId: string;
  savedAt: number;
  layout: WorkspaceLayout;
  lastUsedTabByGroup: Partial<Record<WorkspaceGroupKey, string>>;
  virtualWindows?: WorkspaceVirtualWindow[];
  activeVirtualWindowId?: string;
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

export const workspaceDefaultMinimumSize = { width: 280, height: 180 } as const;
export const maxWorkspacePanels = 4;
