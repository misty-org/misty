import { cn, DropdownMenu, DropdownMenuTrigger, IconButton, TooltipHint } from "@/shared/ui";
import { Settings } from "lucide-react";
import { ProfileNavButton } from "./NavRail";
import { ProfileMenu } from "./ProfileMenu";
import { navigatorHeaderRowClass, navigatorIslandActionClass } from "./styles";

/** Fixed utility and account controls below the navigation scroll area. */
export function NavigatorProfileBar(props: {
  utilityControls?: React.ReactNode;
  profileOpen: boolean;
  settingsOpen: boolean;
  onProfileOpenChange: (open: boolean) => void;
  onOpenAccountSettings: () => void;
  onSettingsClick: () => void;
}) {
  return (
    <div
      className="relative z-20 shrink-0 px-2"
      data-navigator-profile-bar="fixed"
      data-misty-window-drag-block="true"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className={navigatorHeaderRowClass}>
        {props.utilityControls}
        <IconButton
          label="Settings"
          data-navigation-destination="true"
          className={navigatorIslandActionClass}
          aria-pressed={props.settingsOpen}
          onClick={props.onSettingsClick}
        >
          <Settings aria-hidden="true" />
        </IconButton>
        <DropdownMenu
          open={props.profileOpen}
          onOpenChange={props.onProfileOpenChange}
          modal={false}
        >
          <TooltipHint content="Profile">
            <DropdownMenuTrigger asChild>
              <ProfileNavButton
                open={props.profileOpen}
                className={cn(navigatorIslandActionClass, "group/profile")}
              />
            </DropdownMenuTrigger>
          </TooltipHint>
          <ProfileMenu
            onClose={() => props.onProfileOpenChange(false)}
            onOpenAccountSettings={props.onOpenAccountSettings}
          />
        </DropdownMenu>
      </div>
    </div>
  );
}
