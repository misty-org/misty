import { useGlobalSearchStore } from "@/features/global-search";
import { toggleDesktopMistyPanel } from "@/features/desktop-pet";
import { useShortcutTitle } from "@/features/shortcuts";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, cn } from "@/shared/ui";
import { House, Search, Store } from "lucide-react";
import { Link } from "react-router-dom";
import { navigatorFocusRingClass } from "./styles";

const navigatorHeaderActionClass = [
  "misty-navigator-row-target flex h-9 w-full items-center justify-start gap-2.5 rounded-md px-2.5",
  "text-sm text-cream-bright no-underline transition-colors hover:bg-charcoal-card",
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
              if (surface) useWorkspaceStore.getState().openSurface(surface);
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

export function NavigatorHeaderStoreButton(props: { path: string; active: boolean }) {
  return (
    <TooltipProvider delayDuration={450}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={props.path}
            className={cn(navigatorHeaderActionClass, props.active && "bg-charcoal-card")}
            onClick={() => {
              const surface = workspaceSurfaceFromRoute(props.path);
              if (surface) useWorkspaceStore.getState().openSurface(surface);
            }}
            aria-label="Store"
            aria-current={props.active ? "page" : undefined}
            data-misty-window-drag-block="true"
          >
            <Store className="shrink-0" size={18} strokeWidth={1.9} aria-hidden="true" />
            <span>Store</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent>Store</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function NavigatorHeaderSearchButton() {
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
            className={navigatorHeaderActionClass}
            onClick={() => void openSearchPanel()}
            aria-label="Search"
            data-misty-window-drag-block="true"
          >
            <Search className="shrink-0" size={18} strokeWidth={1.85} aria-hidden="true" />
            <span>Search</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{searchShortcutTitle}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
