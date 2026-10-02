import { useBrowserSearchStore } from "@/features/browser-workspace/search";
import { useShortcutTitle } from "@/features/shortcuts";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import {
  appIcons,
  appIconStrokeWidth,
  cn,
  IconButton,
  navigationMenuLinkClass,
  TooltipHint,
} from "@/shared/ui";
import { Search } from "lucide-react";
const { browser: BrowserIcon, agents: AgentIcon, files: FilesIcon, home: HomeIcon } = appIcons;
import { Link, useNavigate } from "react-router-dom";
import { navigatorFocusRingClass } from "./styles";

const navigatorHeaderActionClass = `${navigationMenuLinkClass} w-full`;

type NavigatorIcon = typeof BrowserIcon;

function NavigatorPrimaryLink(props: {
  path: string;
  active: boolean;
  label: string;
  icon: NavigatorIcon;
}) {
  const Icon = props.icon;
  const navigate = useNavigate();
  return (
    <TooltipHint content={props.label}>
      <Link
        to={props.path}
        className={cn(navigatorHeaderActionClass, props.active && "text-cream-bright")}
        onClick={(event) => {
          const surface = workspaceSurfaceFromRoute(props.path);
          if (!surface || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          const tab = useWorkspaceStore.getState().openDestination(surface);
          navigate(tab.route, { replace: true });
        }}
        data-reorder-handle="true"
        data-reorder-header="true"
        aria-label={props.label}
        aria-current={props.active ? "page" : undefined}
        data-navigation-destination="true"
        data-misty-window-drag-block="true"
      >
        <Icon
          className="shrink-0 justify-self-center"
          strokeWidth={appIconStrokeWidth}
          aria-hidden="true"
        />
        <span>{props.label}</span>
      </Link>
    </TooltipHint>
  );
}

export function NavigatorHeaderHomeButton(props: { path: string; active: boolean }) {
  return <NavigatorPrimaryLink {...props} label="Browser" icon={BrowserIcon} />;
}

export function NavigatorHeaderAgentsButton(props: { path: string; active: boolean }) {
  return <NavigatorPrimaryLink {...props} label="Agents" icon={AgentIcon} />;
}

export function NavigatorHeaderFilesButton(props: { path: string; active: boolean }) {
  return <NavigatorPrimaryLink {...props} label="Files" icon={FilesIcon} />;
}

/** Home opens or selects its workspace tab. */
export function NavigatorHomeLink(props: { active: boolean }) {
  return <NavigatorPrimaryLink path="/home" active={props.active} label="Home" icon={HomeIcon} />;
}

export function NavigatorHeaderSearchButton(props?: { className?: string }) {
  const searchShortcutTitle = useShortcutTitle("Search", "search.toggle");

  const openSearchPanel = () => useBrowserSearchStore.getState().show();

  return (
    <IconButton
      variant="nav-action"
      label="Search"
      tooltip={searchShortcutTitle}
      className={cn(navigatorFocusRingClass, props?.className)}
      onClick={openSearchPanel}
      data-misty-window-drag-block="true"
    >
      <Search
        className="size-4 shrink-0"
        size={16}
        strokeWidth={appIconStrokeWidth}
        aria-hidden="true"
      />
    </IconButton>
  );
}
