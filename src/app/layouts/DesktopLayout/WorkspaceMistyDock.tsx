import {
  MistyPanelDock,
  useMistyPanelSide,
  useMistyPanelStore,
  type MistyPanelView,
} from "@/features/agents";
import { SpaceChatPanel } from "@/features/spaces";
import { dockLeaves, spaceWorkspaceToolFromRoute, useWorkspaceStore } from "@/features/app-windows";
import { useMemo } from "react";

/**
 * The panel beside the panes: a rounded card of its own, set off from the page by a margin of
 * window chrome. It holds your Space's chat with people, beside any page but the Chat page.
 */
export function WorkspaceMistyDock() {
  const views = useMistyPanelViews();
  const side = useMistyPanelSide();
  const chat = useMemo(
    () => (
      <SpaceChatPanel side={side} onClose={() => useMistyPanelStore.getState().close("chat")} />
    ),
    [side],
  );
  return <MistyPanelDock views={views} side={side} chat={chat} />;
}

/**
 * The panels shown beside the focused page. Only the Space's chat is one now: agent chats are
 * listed in the sidebar and open as pages, so they have no side panel. The Chat page itself
 * carries none, since it already is that chat.
 */
function useMistyPanelViews(): MistyPanelView[] {
  const chatOpen = useMistyPanelStore((s) => s.chatOpen);
  const onChatPage = useWorkspaceStore((s) => {
    const pane = dockLeaves(s.layout.root).find((leaf) => leaf.id === s.layout.focusedPaneId);
    const current = pane?.views.find((item) => item.id === pane.activeViewId);
    return (
      current?.surfaceId === "space" && spaceWorkspaceToolFromRoute(current.route) === "social"
    );
  });
  return useMemo(() => (chatOpen && !onChatPage ? ["chat"] : []), [chatOpen, onChatPage]);
}
