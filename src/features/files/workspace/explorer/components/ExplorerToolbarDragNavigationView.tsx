import { IconButton } from "@/shared/ui";
import { ArrowUp, ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import type { ExplorerToolbarRuntime } from "./ExplorerToolbarRuntime";
import { toolbarStyles } from "@/features/file-ui";

export function ExplorerToolbarDragNavigationView(props: {
  DropTarget: ExplorerToolbarRuntime["DropTarget"];
  paneId: string;
  backPath: string | null;
  forwardPath: string | null;
  parentPath: string | null;
  onBack: () => void;
  onForward: () => void;
  onParent: () => void;
}) {
  return (
    <>
      <NavigationButton
        DropTarget={props.DropTarget}
        id={`toolbar-back:${props.paneId}`}
        label="Back"
        path={props.backPath}
        icon={ChevronLeft}
        onNavigate={props.onBack}
      />
      <NavigationButton
        DropTarget={props.DropTarget}
        id={`toolbar-forward:${props.paneId}`}
        label="Forward"
        path={props.forwardPath}
        icon={ChevronRight}
        onNavigate={props.onForward}
      />
      <NavigationButton
        DropTarget={props.DropTarget}
        id={`toolbar-parent:${props.paneId}`}
        label="Up one directory"
        path={props.parentPath}
        icon={ArrowUp}
        onNavigate={props.onParent}
      />
    </>
  );
}

function NavigationButton(props: {
  DropTarget: ExplorerToolbarRuntime["DropTarget"];
  id: string;
  label: string;
  path: string | null;
  icon: LucideIcon;
  onNavigate: () => void;
}) {
  const Icon = props.icon;
  const DropTarget = props.DropTarget;
  const button = (
    <IconButton
      size="md"
      label={props.label}
      className={toolbarStyles.navigationButton}
      disabled={!props.path}
      onClick={props.onNavigate}
    >
      <Icon size={18} />
    </IconButton>
  );
  if (!props.path) return button;
  return (
    <DropTarget id={props.id} path={props.path} springLoad onSpringLoad={props.onNavigate}>
      {button}
    </DropTarget>
  );
}
