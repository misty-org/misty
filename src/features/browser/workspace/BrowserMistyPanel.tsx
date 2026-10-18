import type { ReactNode } from "react";
import { Bot, MessagesSquare } from "lucide-react";
import { useMistyPanelStore, type MistyPanelView } from "@/features/agents";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { appIcon, IconButton } from "@/shared/ui";

/**
 * Whether the Misty panel is open. The panel is a column of its own beside the workspace's
 * panes, a panel apart from the page like the tab drawer, so every browser tab shares it.
 */
export function useBrowserMistyPanel(tabId: string) {
  const paneId = useWorkspaceStore(
    (state) => dockLeaves(state.layout.root).find((pane) => pane.activeViewId === tabId)?.id,
  );
  const open = useMistyPanelStore((s) => s.open);
  return { paneId, here: open, open };
}

/** Whether the side panel is open on `view`, for the buttons' pressed state. */
function usePanelShows(view: MistyPanelView) {
  return useMistyPanelStore((s) => (view === "agents" ? s.open : s.chatOpen));
}

/** The toolbar's Chat button: your Space's chat in a side panel (below the agent panel when
 * that is open); again closes it. */
export function BrowserMistyButton() {
  const shown = usePanelShows("chat");
  return (
    <IconButton
      label="Chat"
      aria-pressed={shown}
      onClick={() => useMistyPanelStore.getState().show("chat")}
    >
      {/* Fills its box, so toolbars draw it at the round glyphs' size. */}
      <MessagesSquare aria-hidden className="size-4" />
    </IconButton>
  );
}

const AgentsIcon = appIcon("agents") ?? Bot;

/** Opens the agent side panel (below the chat panel when that is open), or closes it. */
export function showAgentsPanel() {
  useMistyPanelStore.getState().show("agents");
}

/** The toolbar's Agents button, beside Chat: an agent conversation in the side panel. */
export function BrowserAgentsButton() {
  const shown = usePanelShows("agents");
  return (
    <IconButton label="Agents" aria-pressed={shown} onClick={showAgentsPanel}>
      {/* Fills its box like the round glyphs, so the toolbar draws it a size down. */}
      <AgentsIcon aria-hidden className="size-4" />
    </IconButton>
  );
}

/** The content row under the toolbar: the page. */
export function BrowserMistyRow({ children }: { tabId: string; children: ReactNode }) {
  return <div className="flex min-h-0 min-w-0">{children}</div>;
}
