import { allLayoutViews } from "@/features/workspace/layoutTabs";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import {
  groupNameKey,
  setNavigationName,
  tabNameKey,
  useNavigationNames,
  windowNameKey,
} from "./store";
export async function clearNavigationRestoreHistory() {
  const state = useWorkspaceStore.getState(),
    account = useNavigationNames.getState().account;
  const openWindows = Object.values(state.virtualWindowsByScope).flatMap(
    (windows) => windows ?? [],
  );
  const closedWindows = Object.values(state.closedVirtualWindowsByScope).flatMap(
    (windows) => windows ?? [],
  );
  const open = openWindows.flatMap((window) => allLayoutViews(window.layout));
  const closed = [
    ...state.closedTabs.map((entry) => entry.tab),
    ...closedWindows.flatMap((window) => allLayoutViews(window.layout)),
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
  for (const window of openWindows) retained.add(windowNameKey(window.id));
  for (const window of closedWindows) discardedKeys.add(windowNameKey(window.id));
  // Include histories that aged out of the bounded restore list. Inner Files
  // tabs keep their own restore history, so its chrome:* namespace stays separate.
  for (const key of Object.keys(useNavigationNames.getState().names)) {
    if (key.startsWith("tab:tab:") || key.startsWith("group:") || key.startsWith("window:"))
      discardedKeys.add(key);
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
