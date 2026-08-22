import { dockTabs, useWorkspaceStore, type WorkspaceTab } from "@/features/workspace";
import { useMemo } from "react";

export interface HomeRecent {
  id: string;
  title: string;
  subtitle: string;
  route: string;
  surfaceId: WorkspaceTab["surfaceId"];
  lastFocusedAt: number;
  scopeKey: string;
}

/**
 * What you had open, across every Space.
 *
 * The dock persists virtual windows per Space, and every tab records when it
 * was last focused — so "recent" is a read of state that was being stored and
 * never shown. Nothing new is tracked to build this.
 */
export function useHomeRecents(limit = 6): HomeRecent[] {
  const virtualWindowsByScope = useWorkspaceStore((state) => state.virtualWindowsByScope);

  return useMemo(() => {
    const seen = new Set<string>();
    const recents: HomeRecent[] = [];
    for (const [scopeKey, windows] of Object.entries(virtualWindowsByScope)) {
      for (const window of windows ?? []) {
        for (const tab of dockTabs(window.layout.root)) {
          // Home is where this list is displayed, so listing it is noise.
          if (
            tab.surfaceId === "home" ||
            (tab.surfaceId === "space" && tab.groupKey === scopeKey && tab.title === "Space")
          )
            continue;
          const key = `${scopeKey}:${tab.route}:${tab.title}`;
          if (seen.has(key)) continue;
          seen.add(key);
          recents.push({
            id: tab.id,
            title: tab.title,
            subtitle: `${surfaceLabel(tab.surfaceId)} · ${window.title}`,
            route: tab.route,
            surfaceId: tab.surfaceId,
            lastFocusedAt: tab.lastFocusedAt,
            scopeKey,
          });
        }
      }
    }
    return recents.sort((left, right) => right.lastFocusedAt - left.lastFocusedAt).slice(0, limit);
  }, [limit, virtualWindowsByScope]);
}

function surfaceLabel(surfaceId: WorkspaceTab["surfaceId"]): string {
  if (surfaceId === "space") return "Space";
  if (surfaceId === "transfers") return "Transfers";
  if (surfaceId === "extensions") return "Extensions";
  return surfaceId.charAt(0).toUpperCase() + surfaceId.slice(1);
}
