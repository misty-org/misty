import {
  MistyPanelDock,
  mistyPanelWidth,
  useMistyPanelSide,
  useMistyPanelStore,
  type MistyPanelView,
} from "@/features/agents";
import { panelGap } from "@/features/agents/panel/MistyPanelDock";
import { SpaceChatPanel } from "@/features/spaces/chat/SpaceChatPanel";
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

/** The panels shown beside the focused page, top first; none beside a full chat or agents tab. */
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
  // A full chat or agents tab shows no panels; the panels stay open for the tabs that had them.
  return order.filter((view) => (view === "agents" ? agentsOpen : chatOpen) && !page);
}

/**
 * The column the Misty panels take beside the pages, so the tab strip can end its tabs where
 * the pages end: its side, and its widest panel's width with the margin before the page (0
 * while closed).
 */
export function useMistyPanelColumn() {
  const views = useMistyPanelViews();
  const width = useMistyPanelStore((s) =>
    Math.max(0, ...views.map((view) => mistyPanelWidth(s, view))),
  );
  return { side: useMistyPanelSide(), width: views.length ? width + panelGap : 0 };
}
