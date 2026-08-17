import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";
import { useEditorEphemeralStore } from "../store/useEditorEphemeralStore";

export function terminalContextEnv(): Record<string, string> {
  const state = useCodingWorkspaceStore.getState();
  const activeGroup = state.groups.find((group) => group.id === state.activeGroupId);
  const activeTab = activeGroup?.activeTabPath
    ? activeGroup.tabs.find((tab) => tab.path === activeGroup.activeTabPath)
    : null;

  const env: Record<string, string> = {
    MISTY_WORKSPACE_ROOT: state.rootPath ?? "",
  };
  if (activeTab) {
    env.MISTY_ACTIVE_FILE = activeTab.path;
  }
  if (activeGroup) {
    const cursor = useEditorEphemeralStore.getState().cursors[activeGroup.id];
    if (cursor) {
      env.MISTY_ACTIVE_LINE = String(cursor.line);
      env.MISTY_ACTIVE_COLUMN = String(cursor.column);
    }
  }
  return env;
}
