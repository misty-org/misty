import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/ui";
import { Settings } from "lucide-react";
import { HelpMenu } from "./HelpMenu";
import { ProfileNavButton } from "./NavRail";
import { ProfileMenu } from "./ProfileMenu";
import {
  navigatorHeaderRowClass,
  navigatorHierarchyTriggerClass,
  navigatorIslandActionClass,
} from "./styles";

/** Fixed account row below the navigation scroll area, styled like the Misty header row. */
export function NavigatorProfileBar(props: {
  compact?: boolean;
  profileOpen: boolean;
  settingsOpen: boolean;
  onProfileOpenChange: (open: boolean) => void;
  onOpenAccountSettings: () => void;
  onSettingsClick: () => void;
}) {
  return (
    <div
      className={cn("relative z-20 shrink-0", props.compact ? "px-2" : "px-3 pb-2 pt-1")}
      data-navigator-profile-bar="fixed"
      data-misty-window-drag-block="true"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className={navigatorHeaderRowClass}>
        <DropdownMenu open={props.profileOpen} onOpenChange={props.onProfileOpenChange} modal={false}>
          <DropdownMenuTrigger asChild>
            <ProfileNavButton
              open={props.profileOpen}
              className={cn(
                navigatorHierarchyTriggerClass,
                "group/profile relative min-w-0 flex-1 justify-start text-[length:var(--navigation-row-font-size,14px)] font-medium text-cream-muted",
                props.profileOpen && "text-cream-bright",
              )}
              avatarClassName="border-0 bg-transparent ring-0 group-hover/profile:ring-0 [&>*]:!text-[8px]"
              showAccountName={!props.compact}
            />
          </DropdownMenuTrigger>
          <ProfileMenu
            onClose={() => props.onProfileOpenChange(false)}
            onOpenAccountSettings={props.onOpenAccountSettings}
          />
        </DropdownMenu>
        <TooltipProvider delayDuration={450}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className={navigatorIslandActionClass}
                aria-label="Settings"
                aria-pressed={props.settingsOpen}
                onClick={props.onSettingsClick}
              >
                <Settings aria-hidden="true" />
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
