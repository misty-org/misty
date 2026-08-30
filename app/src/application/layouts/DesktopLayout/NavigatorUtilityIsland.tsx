import { useGlobalSearchStore } from "@/features/global-search";
import { toggleDesktopMistyPanel } from "@/features/desktop-pet";
import { useShortcutTitle } from "@/features/shortcuts";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, cn } from "@/shared/ui";
import { House, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { navigatorFocusRingClass } from "./styles";

export function NavigatorHeaderHomeButton(props: { path: string; active: boolean }) {
  return (
    <TooltipProvider delayDuration={450}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={props.path}
            className={cn(
              "misty-navigator-icon-target grid size-9 place-items-center rounded-lg text-cream-bright transition-colors",
              "hover:bg-charcoal-card hover:text-cream-bright",
              navigatorFocusRingClass,
              props.active && "bg-charcoal-card text-cream-bright",
            )}
            onClick={() => {
              const surface = workspaceSurfaceFromRoute(props.path);
              if (surface) useWorkspaceStore.getState().openSurface(surface);
            }}
            aria-label="Home"
            aria-current={props.active ? "page" : undefined}
            data-misty-window-drag-block="true"
          >
            <House size={18} strokeWidth={1.9} aria-hidden="true" />
          </Link>
        </TooltipTrigger>
        <TooltipContent>Home</TooltipContent>
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
            className={cn(
              "misty-navigator-icon-target grid size-9 place-items-center rounded-lg text-cream-bright transition-colors",
              "hover:bg-charcoal-card hover:text-cream-bright",
              navigatorFocusRingClass,
            )}
            onClick={() => void openSearchPanel()}
            aria-label="Search"
            data-misty-window-drag-block="true"
          >
            <Search size={18} strokeWidth={1.85} aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{searchShortcutTitle}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
