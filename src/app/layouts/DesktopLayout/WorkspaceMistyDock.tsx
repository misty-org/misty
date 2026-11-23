import {
  MistyPanelDock,
  useMistyPanelSide,
  useMistyPanelStore,
  type MistyPanelView,
} from "@/features/agents";
import { SpaceChatPanel } from "@/features/spaces";
import { dockLeaves, spaceWorkspaceToolFromRoute, useWorkspaceStore } from "@/features/app-windows";
import { useMemo } from "react";

export function WorkspaceMistyDock() {
  const views = useMistyPanelViews();
  const side = useMistyPanelSide();
  const chat = useMemo(
    () => <SpaceChatPanel side={side} onClose={() => useMistyPanelStore.getState().close()} />,
    [side],
  );
  return <MistyPanelDock views={views} side={side} chat={chat} />;
}

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
