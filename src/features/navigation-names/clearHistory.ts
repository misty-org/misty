import { dockTabs } from "@/features/workspace/dockTree";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { groupNameKey, setNavigationName, tabNameKey, useNavigationNames } from "./store";
export async function clearNavigationRestoreHistory() {
  const state = useWorkspaceStore.getState(),
    account = useNavigationNames.getState().account;
  const open = Object.values(state.virtualWindowsByScope)
    .flatMap((windows) => windows ?? [])
    .flatMap((window) => dockTabs(window.layout.root));
  const closed = [
    ...state.closedTabs.map((entry) => entry.tab),
    ...Object.values(state.closedVirtualWindowsByScope)
      .flatMap((windows) => windows ?? [])
      .flatMap((window) => dockTabs(window.layout.root)),
  ];
  const keys = (tabs: typeof open) =>
    new Set(
      tabs.flatMap((tab) => [
        tabNameKey(tab.id),
        ...(tab.groupInstanceId ? [groupNameKey(tab.groupInstanceId)] : []),
      ]),
    );
  const retained = keys(open);
  const discardedKeys = keys(closed);
  // Include histories that aged out of the bounded restore list. Inner Files
  // tabs keep their own restore history, so its chrome:* namespace stays separate.
  for (const key of Object.keys(useNavigationNames.getState().names)) {
    if (key.startsWith("tab:tab:") || key.startsWith("group:")) discardedKeys.add(key);
  }
  for (const key of discardedKeys) {
    if (account !== useNavigationNames.getState().account)
      throw new Error("The account changed. Reopen the window menu.");
    if (!retained.has(key) && useNavigationNames.getState().names[key] !== undefined)
      await setNavigationName(key, null);
  }
  // Do not discard new close events that arrived while the file writes completed.
  useWorkspaceStore.setState((current) => ({
    closedTabs: current.closedTabs.filter((entry) => !state.closedTabs.includes(entry)),
    closedVirtualWindowsByScope: Object.fromEntries(
      Object.entries(current.closedVirtualWindowsByScope).map(([scope, windows]) => [
        scope,
        windows?.filter(
          (window) =>
            !state.closedVirtualWindowsByScope[
              scope as keyof typeof state.closedVirtualWindowsByScope
            ]?.includes(window),
        ),
      ]),
    ),
  }));
}
