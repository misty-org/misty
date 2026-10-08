import {
  MistyPanelDock,
  useMistyPanelHost,
  useMistyPanelSide,
  useMistyPanelStore,
} from "@/features/agents";

/**
 * The Misty panel beside the panes when no pane shows a browser page. A browser pane
 * holds it in its own content area instead, under the toolbar (see BrowserWorkspace).
 */
export function WorkspaceMistyDock() {
  const open = useMistyPanelStore((s) => s.open);
  const host = useMistyPanelHost();
  const side = useMistyPanelSide();
  return <MistyPanelDock open={open && host === null} side={side} />;
}
