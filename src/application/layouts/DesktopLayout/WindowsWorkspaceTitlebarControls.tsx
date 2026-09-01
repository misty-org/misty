import type { WorkspaceVirtualWindow } from "@/features/workspace";
import { PanelBottomDashed, PanelRightDashed } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { WorkspaceWindowMenu } from "./WorkspaceWindowMenu";

export const dockActionClass = [
  "grid size-7 place-items-center rounded text-cream-muted outline-none",
  "hover:bg-charcoal-card hover:text-cream focus-visible:ring-1 focus-visible:ring-charcoal-active disabled:pointer-events-none disabled:opacity-35",
].join(" ");

export function WindowsWorkspaceTitlebarControls(props: {
  enabled: boolean;
  focused: boolean;
  paneId: string;
  canSplitSideways: boolean;
  canSplitVertically: boolean;
  windows: WorkspaceVirtualWindow[];
  activeWindowId: string;
  canReopen: boolean;
  canCloseWindow: (workspaceWindow: WorkspaceVirtualWindow) => boolean;
  onSplitPane: (paneId: string, direction: "right" | "down") => void;
  onSelectWindow: (windowId: string) => void;
  onCreateWindow: () => void;
  onCloseWindow: (windowId: string) => void;
  onReopenWindow: () => void;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(props.enabled ? document.getElementById("misty-windows-workspace-controls") : null);
  }, [props.enabled]);

  if (!props.enabled || !props.focused || !target) return null;

  return createPortal(
    <>
      <button
        type="button"
        disabled={!props.canSplitSideways}
        className={dockActionClass}
        aria-label="Create split right"
        title="Split right"
        onClick={() => props.onSplitPane(props.paneId, "right")}
      >
        <PanelRightDashed size={18} />
      </button>
      <button
        type="button"
        disabled={!props.canSplitVertically}
        className={dockActionClass}
        aria-label="Create split down"
        title="Split down"
        onClick={() => props.onSplitPane(props.paneId, "down")}
      >
        <PanelBottomDashed size={18} />
      </button>
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
    </>,
    target,
  );
}
