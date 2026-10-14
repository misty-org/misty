import { Settings } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, IconButton, TooltipHint } from "@/shared/ui";
import { ProfileNavButton } from "./NavRail";
import { ProfileMenu } from "./ProfileMenu";

/**
 * The sidebar's closing row, inside its panel: the signed-in profile, then now playing and
 * settings as quiet buttons.
 */
export function AccountIsland(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenAccountSettings: () => void;
  settingsOpen: boolean;
  onSettingsClick: () => void;
}) {
  return (
    <div
      className="misty-sidebar-account"
      data-browser-toolbar
      data-sidebar
      data-misty-window-drag-block="true"
      data-account-island="true"
    >
      <DropdownMenu open={props.open} onOpenChange={props.onOpenChange} modal={false}>
        <TooltipHint content="Profile">
          <DropdownMenuTrigger asChild>
            <ProfileNavButton
              open={props.open}
              showAccountName
              avatarClassName="size-7"
              className={[
                "flex h-7 min-w-0 flex-1 items-center gap-2 rounded-lg border-0 bg-transparent px-0",
                "text-sm font-medium text-cream hover:bg-control-hover",
              ].join(" ")}
            />
          </DropdownMenuTrigger>
        </TooltipHint>
        <ProfileMenu
          onClose={() => props.onOpenChange(false)}
          onOpenAccountSettings={props.onOpenAccountSettings}
        />
      </DropdownMenu>
      <IconButton
        label="Settings"
        aria-pressed={props.settingsOpen}
        onClick={props.onSettingsClick}
      >
        <Settings className="size-4" aria-hidden="true" />
      </IconButton>
    </div>
  );
}
