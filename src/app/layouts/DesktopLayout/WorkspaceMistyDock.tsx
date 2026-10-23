import {
  MistyPanelDock,
  useMistyPanelSide,
  useMistyPanelStore,
  type MistyPanelView,
} from "@/features/agents";
import { SpaceChatPanel } from "@/features/spaces";
import { dockLeaves, spaceWorkspaceToolFromRoute, useWorkspaceStore } from "@/features/workspace";
import { useMemo } from "react";

/**
 * The Misty panels beside the panes: rounded cards of their own, set off from the page and from
 * each other by a margin of window chrome. They hold an agent conversation, your Space's chat,
 * or both stacked (the Agents and Chat buttons), beside any page except a
 * full chat or agents tab, which shows none: the panels stay open for the tabs that had them.
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
 * The panels shown beside the focused page, top first. A full chat or agents tab already is that
 * panel, so only its own panel is left out: Agents still opens beside the Chat page, and Chat
 * beside the Agents page.
 */
function useMistyPanelViews(): MistyPanelView[] {
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
  // The panels stay open for the tabs that had them; a tab hides only the one it already shows.
  return order.filter((view) => (view === "agents" ? agentsOpen : chatOpen) && view !== page);
}
