import type { ReactNode } from "react";
import { MessagesSquare } from "lucide-react";
import { useMistyPanelStore } from "@/features/agents";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { IconButton } from "@/shared/ui";
import { useOpenSpaceChat } from "@/features/spaces/chat/useOpenSpaceChat";

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

/** The toolbar's Chat button: opens your Space's chat, where people talk and agents are mentioned. */
export function BrowserMistyButton() {
  const openChat = useOpenSpaceChat();
  return (
    <IconButton label="Chat" onClick={openChat}>
      <MessagesSquare aria-hidden className="size-4" />
    </IconButton>
  );
}

/** The content row under the toolbar: the page. */
export function BrowserMistyRow({ children }: { tabId: string; children: ReactNode }) {
  return <div className="flex min-h-0 min-w-0">{children}</div>;
}
