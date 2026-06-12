import { Button } from "@/shared/ui";
import { ArrowUp, ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { ExplorerDropTarget } from "../drag/ExplorerDropTarget";
import { toolbarStyles } from "./ExplorerToolbarSupport";

export function ExplorerToolbarDragNavigation(props: {
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
        id={`toolbar-back:${props.paneId}`}
        label="Back"
        path={props.backPath}
        icon={ChevronLeft}
        onNavigate={props.onBack}
      />
      <NavigationButton
        id={`toolbar-forward:${props.paneId}`}
        label="Forward"
        path={props.forwardPath}
        icon={ChevronRight}
        onNavigate={props.onForward}
      />
      <NavigationButton
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
  id: string;
  label: string;
  path: string | null;
  icon: LucideIcon;
  onNavigate: () => void;
}) {
  const Icon = props.icon;
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={props.label}
      title={props.label}
      className={toolbarStyles.navigationButton}
      disabled={!props.path}
      onClick={props.onNavigate}
    >
      <Icon size={18} />
    </Button>
  );
  if (!props.path) return button;
  return (
    <ExplorerDropTarget id={props.id} path={props.path} springLoad onSpringLoad={props.onNavigate}>
      {button}
    </ExplorerDropTarget>
  );
}
