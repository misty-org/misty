import { MistyPanelDock, useMistyPanelSide, useMistyPanelStore } from "@/features/agents";

/**
 * The Misty panel beside the panes: a rounded panel of its own, set off from the page by a margin
 * of window chrome, as the tab drawer is on the other side.
 */
export function WorkspaceMistyDock() {
  const open = useMistyPanelStore((s) => s.open);
  const side = useMistyPanelSide();
  return <MistyPanelDock open={open} side={side} />;
}
