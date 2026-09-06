import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { dockLeaves, useWorkspaceStore, type WorkspaceTab } from "@/features/workspace";
import { selectTerminalPreferences, useSettingsStore } from "@/features/settings";
import {
  detectShortcutPlatform,
  formatShortcutLabel,
  registerShortcutHandler,
  useEffectiveShortcut,
} from "@/features/shortcuts";
import { useAiSurfaceAdapter, type AiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import { terminalHostServices } from "./terminalHostServices";
import { TerminalWorkspaceView } from "./TerminalWorkspaceView";
export { killTerminalTab } from "./TerminalWorkspaceView";

function TerminalAiBridge({ adapter }: { adapter: AiSurfaceAdapter }) {
  useAiSurfaceAdapter(adapter);
  return null;
}
const renderAiAdapter = (adapter: AiSurfaceAdapter) => <TerminalAiBridge adapter={adapter} />;

/** Host-only integration for the temporary embedded catalog entry. */
export function TerminalWorkspace(props: { tab?: WorkspaceTab; active?: boolean }) {
  const preferences = useSettingsStore(
    useShallow((state) => selectTerminalPreferences(state.settings?.document)),
  );
  const fallbackTab = useWorkspaceStore((state) => {
    const leaves = dockLeaves(state.layout.root);
    const pane = leaves.find((item) => item.id === state.layout.focusedPaneId) ?? leaves[0];
    const tab = pane?.tabs.find((item) => item.id === pane.activeTabId);
    return tab?.surfaceId === "terminal" ? tab : undefined;
  });
  const tabId = (props.tab ?? fallbackTab)?.id ?? null;
  const focused = useWorkspaceStore((state) => {
    const pane = dockLeaves(state.layout.root).find(
      (item) => item.id === state.layout.focusedPaneId,
    );
    return Boolean(tabId && pane?.activeTabId === tabId);
  });
  const renameTab = useCallback(
    (title: string) => {
      if (tabId) useWorkspaceStore.getState().renameTab(tabId, title);
    },
    [tabId],
  );
  const searchBinding = useEffectiveShortcut("terminal.search");
  return (
    <TerminalWorkspaceView
      tabId={tabId}
      active={props.active ?? true}
      focused={focused}
      services={terminalHostServices}
      preferences={preferences}
      renameTab={renameTab}
      searchShortcutLabel={
        formatShortcutLabel(searchBinding.primary, detectShortcutPlatform()) || "⌘F"
      }
      registerCommand={registerShortcutHandler}
      renderAiAdapter={renderAiAdapter}
    />
  );
}
