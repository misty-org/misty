import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, cn } from "@/shared/ui";
import { Settings } from "lucide-react";
import type { RefObject } from "react";
import { ActivityMenu } from "./ActivityMenu";
import { ProfileNavButton } from "./NavRail";
import {
  navigatorFloatingIslandClass,
  navigatorFocusRingClass,
  navigatorIslandActionClass,
} from "./styles";

/**
 * The account dock, floating over the navigator's scrolling body.
 *
 * It sits on top of the rail rather than in the column flow so the Spaces and
 * Tools lists can scroll the full height behind it and it never scrolls away.
 * The navigation list reserves room for it with its own bottom padding.
 */
export function NavigatorProfileBar(props: {
  profileAnchorRef: RefObject<HTMLButtonElement | null>;
  profileOpen: boolean;
  settingsOpen: boolean;
  onProfileClick: () => void;
  onSettingsClick: () => void;
}) {
  return (
    <div
      className="absolute inset-x-2 bottom-2 z-20"
      data-navigator-profile-bar="floating"
      data-misty-window-drag-block="true"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className={navigatorFloatingIslandClass}>
        <ProfileNavButton
          ref={props.profileAnchorRef}
          open={props.profileOpen}
          onClick={props.onProfileClick}
          className={cn(
            "group/profile relative flex min-w-0 items-center rounded-lg border-0 bg-transparent",
            "text-sm text-cream no-underline outline-none transition-colors",
            "misty-navigator-row-target h-9 flex-1 justify-start gap-2 px-1.5 hover:bg-charcoal-active",
            navigatorFocusRingClass,
            props.profileOpen && "bg-charcoal-active",
          )}
          avatarClassName="size-7 border-0 bg-transparent ring-0 group-hover/profile:ring-0"
          showAccountName
        />
        <ActivityMenu className={cn(navigatorIslandActionClass)} />
        <TooltipProvider delayDuration={450}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  navigatorIslandActionClass,
                  props.settingsOpen && "bg-charcoal-active text-cream-bright",
                )}
                aria-label="Settings"
                onClick={props.onSettingsClick}
              >
                <Settings size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
