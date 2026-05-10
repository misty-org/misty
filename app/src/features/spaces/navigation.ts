import { dockLeaves, useWorkspaceStore } from "@/features/workspace";

const validSpaceSections = new Set(["chat", "planner", "notes", "drawings", "library"]);

export function spaceLandingRoute(
  spaceId: string,
  accountId?: string,
  currentPathname?: string,
): string {
  const scopeKey = `space:${spaceId}` as const;
  const store = useWorkspaceStore.getState();
  const spaceLayout = store.layoutsByScope[scopeKey];
  if (spaceLayout) {
    const leaves = dockLeaves(spaceLayout.root);
    const focused = leaves.find((leaf) => leaf.id === spaceLayout.focusedPaneId) ?? leaves[0];
    const activeTab =
      focused?.tabs.find((tab) => tab.id === focused.activeTabId) ?? focused?.tabs[0];
    if (activeTab?.route) {
      return activeTab.route;
    }
  }

  const encodedSpaceId = encodeURIComponent(spaceId);
  const base = `/spaces/${encodedSpaceId}`;
  if (currentPathname) {
    const parts = currentPathname.split("/").filter(Boolean);
    if (parts[0] === "spaces") {
      const requestedSection = parts[2] === "files" ? "library" : parts[2];
      if (requestedSection && validSpaceSections.has(requestedSection)) {
        return `${base}/${requestedSection}`;
      }
    }
  }

  return base;
}

export function spaceDestination(pathname: string, spaceId: string, accountId?: string): string {
  return spaceLandingRoute(spaceId, accountId, pathname);
}
