import { useGlobalSearchStore } from "@/features/global-search";
import { toggleDesktopMistyPanel } from "@/features/desktop-pet";
import { useShortcutTitle } from "@/features/shortcuts";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, cn } from "@/shared/ui";
import { Compass, House, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { navigationMenuPrimaryLayoutClass } from "@/shared/ui";
import { navigatorFocusRingClass } from "./styles";

const navigatorHeaderActionClass = [
  "misty-navigator-row-target h-9 w-full rounded-md px-2.5",
  "text-sm text-cream-bright no-underline transition-colors hover:bg-charcoal-card",
  navigationMenuPrimaryLayoutClass,
  navigatorFocusRingClass,
].join(" ");

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
            <House className="shrink-0" size={18} strokeWidth={1.9} aria-hidden="true" />
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
            <Compass className="shrink-0" size={18} strokeWidth={1.9} aria-hidden="true" />
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
            className={cn(
              "misty-navigator-row-target grid size-9 shrink-0 place-items-center rounded-md border-0 bg-transparent text-cream-muted transition-colors",
              "hover:bg-charcoal-card/60 hover:text-cream-bright",
              navigatorFocusRingClass,
              props?.className,
            )}
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
