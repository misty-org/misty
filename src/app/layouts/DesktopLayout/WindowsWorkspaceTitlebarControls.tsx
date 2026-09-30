import type { WorkspaceWindow } from "@/features/workspace";
import type { ReactNode } from "react";
import { IconButton, PortalToId, OverlaySideProvider } from "@/shared/ui";
import { PanelBottomDashed, PanelRightDashed } from "lucide-react";
import { WorkspaceWindowMenu } from "./WorkspaceWindowMenu";

export function WindowsWorkspaceTitlebarControls(props: {
  enabled: boolean;
  focused: boolean;
  paneId: string;
  canSplitSideways: boolean;
  canSplitVertically: boolean;
  closePaneControl: ReactNode;
  windows: WorkspaceWindow[];
  activeWindowId: string;
  canReopen: boolean;
  canCloseWindow: (workspaceWindow: WorkspaceWindow) => boolean;
  onSplitPane: (paneId: string, direction: "right" | "down") => void;
  onSelectWindow: (windowId: string) => void;
  onCreateWindow: () => void;
  onCloseWindow: (windowId: string) => void;
  onReopenWindow: () => void;
}) {
  if (!props.enabled || !props.focused) return null;

  return (
    <PortalToId targetId="misty-windows-workspace-controls">
      <OverlaySideProvider value="bottom">
        <IconButton
          size="xs"
          tooltip={false}
          disabled={!props.canSplitSideways}
          label="Create split right"
          title="Split right"
          onClick={() => props.onSplitPane(props.paneId, "right")}
        >
          <PanelRightDashed className="size-4" size={16} />
        </IconButton>
        <IconButton
          size="xs"
          tooltip={false}
          disabled={!props.canSplitVertically}
          label="Create split down"
          title="Split down"
          onClick={() => props.onSplitPane(props.paneId, "down")}
        >
          <PanelBottomDashed className="size-4" size={16} />
        </IconButton>
        {props.closePaneControl}
        <WorkspaceWindowMenu
          windows={props.windows}
          activeWindowId={props.activeWindowId}
          canReopen={props.canReopen}
          canCloseWindow={props.canCloseWindow}
          onSelect={props.onSelectWindow}
          onCreate={props.onCreateWindow}
          onClose={props.onCloseWindow}
          onReopen={props.onReopenWindow}
        />
      </OverlaySideProvider>
    </PortalToId>
  );
}
