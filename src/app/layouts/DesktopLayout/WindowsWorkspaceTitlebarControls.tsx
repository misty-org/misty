import type { ReactNode } from "react";
import { IconButton, PortalToId, OverlaySideProvider } from "@/shared/ui";
import { PanelBottomDashed, PanelRightDashed } from "lucide-react";
import { SpaceWindowMenu } from "./SpaceWindowMenu";

export function WindowsWorkspaceTitlebarControls(props: {
  enabled: boolean;
  focused: boolean;
  paneId: string;
  canSplitSideways: boolean;
  canSplitVertically: boolean;
  closePaneControl: ReactNode;
  onSplitPane: (paneId: string, direction: "right" | "down") => void;
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
        <SpaceWindowMenu />
      </OverlaySideProvider>
    </PortalToId>
  );
}
