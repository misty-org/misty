import { workspaceTabsById } from "@/features/workspace/layoutTabs";
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
  const open = [...workspaceTabsById(state).values()];
  const closed = state.closedItems.map((entry) => entry.view);
  const keys = (tabs: typeof open) =>
    new Set(
      tabs.flatMap((tab) => [
        tabNameKey(tab.id),
        ...(tab.groupInstanceId ? [groupNameKey(tab.groupInstanceId)] : []),
      ]),
    );
  const retained = keys(open);
  const discardedKeys = keys(closed);
  retained.add(windowNameKey(state.activeWindowId));
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
  }));
}
