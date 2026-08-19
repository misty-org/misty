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
 * The dock already persists a layout per Space, and every tab records when it
 * was last focused — so "recent" is a read of state that was being stored and
 * never shown. Nothing new is tracked to build this.
 */
export function useHomeRecents(limit = 6): HomeRecent[] {
  const layoutsByScope = useWorkspaceStore((state) => state.layoutsByScope);
  const activeScopeKey = useWorkspaceStore((state) => state.activeScopeKey);
  const layout = useWorkspaceStore((state) => state.layout);

  return useMemo(() => {
    const scopes: [string, typeof layout][] = [
      [activeScopeKey, layout],
      ...Object.entries(layoutsByScope)
        .filter(([scope, value]) => scope !== activeScopeKey && Boolean(value))
        .map(([scope, value]) => [scope, value] as [string, typeof layout]),
    ];

    const seen = new Set<string>();
    const recents: HomeRecent[] = [];
    for (const [scopeKey, scopeLayout] of scopes) {
      for (const tab of dockTabs(scopeLayout.root)) {
        // Home is where this list is displayed, so listing it is noise.
        if (tab.surfaceId === "home") continue;
        const key = `${scopeKey}:${tab.route}:${tab.title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        recents.push({
          id: tab.id,
          title: tab.title,
          subtitle: surfaceLabel(tab.surfaceId),
          route: tab.route,
          surfaceId: tab.surfaceId,
          lastFocusedAt: tab.lastFocusedAt,
          scopeKey,
        });
      }
    }
    return recents.sort((left, right) => right.lastFocusedAt - left.lastFocusedAt).slice(0, limit);
  }, [activeScopeKey, layout, layoutsByScope, limit]);
}

function surfaceLabel(surfaceId: WorkspaceTab["surfaceId"]): string {
  if (surfaceId === "space") return "Space";
  if (surfaceId === "transfers") return "Transfers";
  if (surfaceId === "extensions") return "Extensions";
  return surfaceId.charAt(0).toUpperCase() + surfaceId.slice(1);
}
