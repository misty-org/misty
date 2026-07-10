import { useBrowserSearchStore } from "@/features/browser-workspace/search";
import { useShortcutTitle } from "@/features/shortcuts";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, Button, cn } from "@/shared/ui";
import { PanelsTopLeft, Search } from "lucide-react";
import { appIcons, appIconStrokeWidth } from "@/shared/ui/app-icons";
const { browser: BrowserIcon, agents: AgentIcon, files: FilesIcon } = appIcons;
import { Link } from "react-router-dom";
import { navigationMenuLinkClass } from "@/shared/ui";
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
  return (
    <Link
      to={props.path}
      className={cn(navigatorHeaderActionClass, props.active && "text-cream-bright")}
      onClick={(event) => {
        const surface = workspaceSurfaceFromRoute(props.path);
        if (surface && useWorkspaceStore.getState().openSurface(surface).route !== surface.route)
          event.preventDefault();
      }}
      data-reorder-handle="true"
      data-reorder-header="true"
      aria-label={props.label}
      aria-current={props.active ? "page" : undefined}
      data-misty-window-drag-block="true"
    >
      <Icon
        className="shrink-0 justify-self-center"
        strokeWidth={appIconStrokeWidth}
        aria-hidden="true"
      />
      <span>{props.label}</span>
    </Link>
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

export function NavigatorHeaderSearchButton(props?: { className?: string }) {
  const searchShortcutTitle = useShortcutTitle("Search", "search.toggle");

  const openSearchPanel = () => useBrowserSearchStore.getState().show();

  return (
    <TooltipProvider delayDuration={450}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="nav-action"
            size="icon-sm"
            className={cn(navigatorFocusRingClass, props?.className)}
            onClick={openSearchPanel}
            aria-label="Search"
            data-misty-window-drag-block="true"
          >
            <Search
              className="size-4 shrink-0"
              size={16}
              strokeWidth={appIconStrokeWidth}
              aria-hidden="true"
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{searchShortcutTitle}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function NavigatorHeaderSpacesButton({ active }: { active: boolean }) {
  return (
    <Link
      to="/spaces"
      onClick={() => {
        const surface = workspaceSurfaceFromRoute("/spaces");
        if (surface) useWorkspaceStore.getState().openSurface(surface);
      }}
      aria-label="Spaces"
      aria-current={active ? "page" : undefined}
      className={cn(navigatorHeaderActionClass, active && "text-cream-bright")}
      data-misty-window-drag-block="true"
    >
      <PanelsTopLeft
        className="shrink-0 justify-self-center"
        strokeWidth={appIconStrokeWidth}
        aria-hidden="true"
      />
      <span>Spaces</span>
    </Link>
  );
}
