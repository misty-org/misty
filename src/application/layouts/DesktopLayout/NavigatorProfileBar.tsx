import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, Button, cn } from "@/shared/ui";
import { Settings } from "lucide-react";
import type { RefObject } from "react";
import { HelpMenu } from "./HelpMenu";
import { ProfileNavButton } from "./NavRail";
import {
  navigatorFloatingIslandClass,
  navigatorHierarchyTriggerClass,
  navigatorIslandActionClass,
} from "./styles";

/** Fixed account island below the navigation scroll area. */
export function NavigatorProfileBar(props: {
  compact?: boolean;
  profileAnchorRef: RefObject<HTMLButtonElement | null>;
  profileOpen: boolean;
  settingsOpen: boolean;
  onProfileClick: () => void;
  onSettingsClick: () => void;
}) {
  return (
    <div
      className={cn("relative z-20 shrink-0", props.compact ? "mx-2" : "mx-3 mb-2 mt-1")}
      data-navigator-profile-bar="fixed"
      data-misty-window-drag-block="true"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className={navigatorFloatingIslandClass}>
        <ProfileNavButton
          ref={props.profileAnchorRef}
          open={props.profileOpen}
          onClick={props.onProfileClick}
          className={cn(
            navigatorHierarchyTriggerClass,
            "group/profile relative flex-1 justify-start text-sm font-semibold tracking-[-0.015em] hover:bg-charcoal-active focus-visible:bg-charcoal-active",
            props.profileOpen && "bg-charcoal-active text-cream-bright",
          )}
          avatarClassName="size-6 border-0 bg-transparent ring-0 group-hover/profile:ring-0"
          showAccountName={!props.compact}
        />
        <TooltipProvider delayDuration={450}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  navigatorIslandActionClass,
                  props.settingsOpen && "bg-charcoal-active text-cream-bright",
                )}
                aria-label="Settings"
                onClick={props.onSettingsClick}
              >
                <Settings size={18} strokeWidth={1.75} aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <HelpMenu className={navigatorIslandActionClass} />
      </div>
    </div>
  );
}
