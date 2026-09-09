import { useGlobalSearchStore } from "@/features/global-search";
import { toggleDesktopMistyPanel } from "@/features/desktop-pet";
import { useShortcutTitle } from "@/features/shortcuts";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, cn } from "@/shared/ui";
import { Search } from "lucide-react";
import { appIcons, appIconStrokeWidth } from "@/shared/ui/app-icons";
const { home: House, marketplace: Compass } = appIcons;
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
            className={cn(navigatorHeaderActionClass, props.active && "bg-charcoal-card")}
            onClick={() => {
              const surface = workspaceSurfaceFromRoute(props.path);
              if (surface) useWorkspaceStore.getState().addSurface(surface);
            }}
            aria-label="Home"
            aria-current={props.active ? "page" : undefined}
            data-misty-window-drag-block="true"
          >
            <House
              className="shrink-0"
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
            className={cn(navigatorHeaderActionClass, props.active && "bg-charcoal-card")}
            onClick={() => {
              const surface = workspaceSurfaceFromRoute(props.path);
              if (surface) useWorkspaceStore.getState().addSurface(surface);
            }}
            aria-label="Discover"
            aria-current={props.active ? "page" : undefined}
            data-misty-window-drag-block="true"
          >
            <Compass
              className="shrink-0"
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
