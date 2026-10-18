import {
  MistyPanelDock,
  useMistyPanelSide,
  useMistyPanelStore,
  type MistyPanelView,
} from "@/features/agents";
import { SpaceChatPanel } from "@/features/spaces/chat/SpaceChatPanel";
import { dockLeaves, spaceWorkspaceToolFromRoute, useWorkspaceStore } from "@/features/workspace";
import { useMemo } from "react";

/**
 * The Misty panel beside the panes: a rounded panel of its own, set off from the page by a margin
 * of window chrome, as the tab drawer is on the other side. It holds an agent conversation, your
 * Space's chat, or both split in half (the Agents and Chat buttons), beside any page except a
 * full chat or agents tab, which shows none: the panels stay open for the tabs that had them.
 */
export function WorkspaceMistyDock() {
  const agentsOpen = useMistyPanelStore((s) => s.open);
  const chatOpen = useMistyPanelStore((s) => s.chatOpen);
  const first = useMistyPanelStore((s) => s.first);
  // The page the focused pane shows, so a full chat or agents tab carries no panels.
  const page = useWorkspaceStore((s) => {
    const pane = dockLeaves(s.layout.root).find((leaf) => leaf.id === s.layout.focusedPaneId);
    const current = pane?.views.find((item) => item.id === pane.activeViewId);
    if (!current) return "";
    if (current.surfaceId === "agents" || current.surfaceId === "scheduled") return "agents";
    return current.surfaceId === "space" && spaceWorkspaceToolFromRoute(current.route) === "social"
      ? "chat"
      : "";
  });
  const order: MistyPanelView[] = first === "chat" ? ["chat", "agents"] : ["agents", "chat"];
  // A full chat or agents tab shows no panels; the panels stay open for the tabs that had them.
  const views = order.filter((view) => (view === "agents" ? agentsOpen : chatOpen) && !page);
  const side = useMistyPanelSide();
  const chat = useMemo(
    () => (
      <SpaceChatPanel side={side} onClose={() => useMistyPanelStore.getState().close("chat")} />
    ),
    [side],
  );
  return <MistyPanelDock views={views} side={side} chat={chat} />;
}
