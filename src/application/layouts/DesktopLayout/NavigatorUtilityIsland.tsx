import { useBrowserSearchStore } from "@/features/browser-workspace/search";
import { useShortcutTitle } from "@/features/shortcuts";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, Button, cn } from "@/shared/ui";
import { PanelsTopLeft, Search } from "lucide-react";
import { appIcons, appIconStrokeWidth } from "@/shared/ui/app-icons";
const { home: House, agents: AgentIcon, files: FilesIcon } = appIcons;
import { Link } from "react-router-dom";
import { navigationMenuLinkClass } from "@/shared/ui";
import { navigatorFocusRingClass } from "./styles";

const navigatorHeaderActionClass = `${navigationMenuLinkClass} w-full`;

export function NavigatorHeaderHomeButton(props: { path: string; active: boolean }) {
  return (
    <TooltipProvider delayDuration={450}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={props.path}
            className={cn(navigatorHeaderActionClass, props.active && "text-cream-bright")}
            onClick={(event) => {
              const surface = workspaceSurfaceFromRoute(props.path);
              if (
                surface &&
                useWorkspaceStore.getState().openSurface(surface).route !== surface.route
              )
                event.preventDefault();
            }}
            data-reorder-handle="true"
            data-reorder-header="true"
            title="Drag to reorder · Alt+Shift+↑/↓"
            aria-label="Home"
            aria-current={props.active ? "page" : undefined}
            data-misty-window-drag-block="true"
          >
            <House
              className="shrink-0 justify-self-center"
              size={18}
              strokeWidth={appIconStrokeWidth}
              aria-hidden="true"
            />
            <span>Home</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent>Home</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function NavigatorHeaderAgentsButton(props: { path: string; active: boolean }) {
  return (
    <TooltipProvider delayDuration={450}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={props.path}
            className={cn(navigatorHeaderActionClass, props.active && "text-cream-bright")}
            onClick={(event) => {
              const surface = workspaceSurfaceFromRoute(props.path);
              if (
                surface &&
                useWorkspaceStore.getState().openSurface(surface).route !== surface.route
              )
                event.preventDefault();
            }}
            data-reorder-handle="true"
            data-reorder-header="true"
            title="Drag to reorder · Alt+Shift+↑/↓"
            aria-label="Agents"
            aria-current={props.active ? "page" : undefined}
            data-misty-window-drag-block="true"
          >
            <AgentIcon
              className="shrink-0 justify-self-center"
              size={18}
              strokeWidth={appIconStrokeWidth}
              aria-hidden="true"
            />
            <span>Agents</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent>Agents</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function NavigatorHeaderFilesButton(props: { path: string; active: boolean }) {
  return (
    <TooltipProvider delayDuration={450}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={props.path}
            className={cn(navigatorHeaderActionClass, props.active && "text-cream-bright")}
            onClick={(event) => {
              const surface = workspaceSurfaceFromRoute(props.path);
              if (
                surface &&
                useWorkspaceStore.getState().openSurface(surface).route !== surface.route
              )
                event.preventDefault();
            }}
            data-reorder-handle="true"
            data-reorder-header="true"
            title="Drag to reorder · Alt+Shift+↑/↓"
            aria-label="Files"
            aria-current={props.active ? "page" : undefined}
            data-misty-window-drag-block="true"
          >
            <FilesIcon
              className="shrink-0 justify-self-center"
              size={18}
              strokeWidth={appIconStrokeWidth}
              aria-hidden="true"
            />
            <span>Files</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent>Files</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
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
            <Search className="shrink-0" size={18} strokeWidth={1.85} aria-hidden="true" />
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
      <PanelsTopLeft size={18} strokeWidth={appIconStrokeWidth} aria-hidden="true" />
      <span>Spaces</span>
    </Link>
  );
}
