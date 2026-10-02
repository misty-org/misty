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
  const openWindows = Object.values(state.windowsByScope).flatMap((windows) => windows ?? []);
  const closedWindows = Object.values(state.closedWindowsByScope).flatMap(
    (windows) => windows ?? [],
  );
  const open = openWindows.flatMap((window) => allLayoutViews(window.layout));
  const closed = [
    ...state.closedItems.map((entry) => entry.view),
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
    closedItems: current.closedItems.filter((entry) => !state.closedItems.includes(entry)),
    closedWindowsByScope: Object.fromEntries(
      Object.entries(current.closedWindowsByScope).map(([scope, windows]) => [
        scope,
        windows?.filter(
          (window) =>
            !state.closedWindowsByScope[scope as keyof typeof state.closedWindowsByScope]?.includes(
              window,
            ),
        ),
      ]),
    ),
  }));
}
