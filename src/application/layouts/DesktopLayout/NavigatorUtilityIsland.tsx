import { useGlobalSearchStore } from "@/features/global-search";
import { toggleDesktopMistyPanel } from "@/features/desktop-pet";
import { useShortcutTitle } from "@/features/shortcuts";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, cn } from "@/shared/ui";
import { Search } from "lucide-react";
import { appIcons, appIconStrokeWidth } from "@/shared/ui/app-icons";
const { home: House, marketplace: Compass, agents: AgentIcon } = appIcons;
import { Link } from "react-router-dom";
import { navigationMenuLinkClass, navigationMenuActionClass } from "@/shared/ui";
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

export function NavigatorHeaderDiscoverButton(props: { path: string; active: boolean }) {
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
            aria-label="Discover"
            aria-current={props.active ? "page" : undefined}
            data-misty-window-drag-block="true"
          >
            <Compass
              className="shrink-0 justify-self-center"
              size={18}
              strokeWidth={appIconStrokeWidth}
              aria-hidden="true"
            />
            <span>Discover</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent>Discover</TooltipContent>
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

export function NavigatorHeaderSearchButton(props?: { className?: string }) {
  const searchShortcutTitle = useShortcutTitle("Search", "search.toggle");

  const openSearchPanel = async () => {
    try {
      if (await toggleDesktopMistyPanel()) return;
    } catch {
      // If the companion window is unavailable, the in-app panel is equivalent.
    }
    useGlobalSearchStore.getState().openPanel();
    window.setTimeout(
      () => document.querySelector<HTMLInputElement>("[data-global-misty-launcher-input]")?.focus(),
      0,
    );
  };

  return (
    <TooltipProvider delayDuration={450}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(navigationMenuActionClass, navigatorFocusRingClass, props?.className)}
            onClick={() => void openSearchPanel()}
            aria-label="Search"
            data-misty-window-drag-block="true"
          >
            <Search className="shrink-0" size={18} strokeWidth={1.85} aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{searchShortcutTitle}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
