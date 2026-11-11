import { useInRouterContext, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useShortcutHandler } from "@/features/shortcuts";
import { useFocusedPaneHistory } from "@/features/app-windows";
import { IconButton, toolbarIconProps } from "@/shared/ui";

function NavButtons(props: {
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
}) {
  return (
    // Sidebar chrome, 6px apart.
    <div className="flex items-center gap-1.5" data-browser-toolbar data-sidebar>
      <IconButton tooltip={false} label="Back" disabled={!props.canBack} onClick={props.onBack}>
        <ArrowLeft {...toolbarIconProps} />
      </IconButton>
      <IconButton
        tooltip={false}
        label="Forward"
        disabled={!props.canForward}
        onClick={props.onForward}
      >
        <ArrowRight {...toolbarIconProps} />
      </IconButton>
    </div>
  );
}

/** Back and forward through the focused pane's own pages, as the router's own `go` does. */
function PaneHistoryNav() {
  const navigate = useNavigate();
  const history = useFocusedPaneHistory();
  const { go } = history;
  const travel = (delta: -1 | 1) => {
    const view = go(delta);
    if (!view) return false;
    navigate(view.route, { replace: true });
    return true;
  };
  useShortcutHandler("navigation.back", () => history.canBack && travel(-1));
  useShortcutHandler("navigation.forward", () => history.canForward && travel(1));
  return (
    <NavButtons
      canBack={history.canBack}
      canForward={history.canForward}
      onBack={() => travel(-1)}
      onForward={() => travel(1)}
    />
  );
}

/** The sidebar head's back and forward buttons. */
export function SidebarNav() {
  const routed = useInRouterContext();
  return routed ? (
    <PaneHistoryNav />
  ) : (
    <NavButtons canBack={false} canForward={false} onBack={() => {}} onForward={() => {}} />
  );
}
