import {
  allLayoutViews,
  isPrivateBrowserTab,
  parseBrowserTabState,
  useWorkspaceStore,
  type WorkspaceTab,
} from "@/features/workspace";
import { useMemo } from "react";

export interface ContinueItem {
  tab: WorkspaceTab;
  /** Where the tab lives: a site's host, a Files location, or a Space tool. */
  detail: string;
  faviconUrl: string | null;
  /** Set for Space tools, so the page can show the Space's avatar and name. */
  spaceId?: string;
  windowTitle: string;
}

/**
 * Open workspace tabs across every virtual window, most recently focused first. Private
 * tabs never appear here: Home must not show where they were.
 */
export function useContinueItems(limit = Infinity): ContinueItem[] {
  const layout = useWorkspaceStore((state) => state.layout);
  const windowsByScope = useWorkspaceStore((state) => state.virtualWindowsByScope);
  const activeWindowId = useWorkspaceStore((state) => state.activeVirtualWindowId);

  return useMemo(() => {
    const seen = new Set<string>();
    const items: ContinueItem[] = [];
    const add = (tabs: WorkspaceTab[], windowTitle: string) => {
      for (const tab of tabs) {
        if (seen.has(tab.id) || tab.placeholder || isPrivateBrowserTab(tab)) continue;
        seen.add(tab.id);
        items.push({ tab, windowTitle, ...describeTab(tab) });
      }
    };
    const windows = Object.values(windowsByScope).flatMap((list) => list ?? []);
    // The active window's live layout is newer than its stored snapshot.
    const active = windows.find((window) => window.id === activeWindowId);
    add(allLayoutViews(layout), active?.title ?? "");
    for (const window of windows) {
      if (window.id !== activeWindowId) add(allLayoutViews(window.layout), window.title);
    }
    return items.sort((a, b) => b.tab.lastFocusedAt - a.tab.lastFocusedAt).slice(0, limit);
  }, [activeWindowId, layout, limit, windowsByScope]);
}

export function describeTab(
  tab: WorkspaceTab,
): Pick<ContinueItem, "detail" | "faviconUrl" | "spaceId"> {
  if (tab.surfaceId === "browser") {
    const state = parseBrowserTabState(tab.state);
    let host = "";
    try {
      host = /^https?:/i.test(state.url) ? new URL(state.url).host.replace(/^www\./, "") : "";
    } catch {
      host = "";
    }
    return { detail: host || "New tab", faviconUrl: state.faviconUrl };
  }
  if (tab.surfaceId === "files") return { detail: "Files", faviconUrl: null };
  if (tab.surfaceId === "agents") return { detail: "Agents", faviconUrl: null };
  if (tab.surfaceId === "space") {
    // Space tools are keyed `${spaceId}:${tool}`.
    const separator = tab.instanceKey.lastIndexOf(":");
    const spaceId = separator > 0 ? tab.instanceKey.slice(0, separator) : undefined;
    return { detail: "Space", faviconUrl: null, spaceId };
  }
  return { detail: "", faviconUrl: null };
}

/** Only external websites have content suitable for Home's visual previews. */
export function isHomePreviewTab(tab: WorkspaceTab): boolean {
  if (tab.surfaceId !== "browser" || tab.placeholder) return false;
  const browser = parseBrowserTabState(tab.state);
  if (browser.private) return false;
  try {
    const { protocol } = new URL(browser.url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
