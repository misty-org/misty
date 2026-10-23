import { Settings } from "lucide-react";
import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  IconButton,
  toolbarIconProps,
  TooltipHint,
} from "@/shared/ui";
import { preloadSettingsWorkspace } from "@/features/settings";
import { ProfileNavButton } from "./NavRail";
import { ProfileMenu } from "./ProfileMenu";

/**
 * The sidebar's closing row, inside its panel: the signed-in profile, then Sync and Settings
 * as quiet buttons.
 */
export function AccountIsland(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenAccountSettings: () => void;
  settingsOpen: boolean;
  onSettingsClick: () => void;
  /** The Sync button, beside Settings. */
  sync?: ReactNode;
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
      {props.sync}
      <IconButton
        label="Settings"
        aria-pressed={props.settingsOpen}
        onPointerEnter={() => void preloadSettingsWorkspace().catch(() => undefined)}
        onFocus={() => void preloadSettingsWorkspace().catch(() => undefined)}
        onClick={props.onSettingsClick}
      >
        {/* A round glyph: the sidebar draws it a size down so it reads like the line icons. */}
        <Settings {...toolbarIconProps} className="size-4" />
      </IconButton>
    </div>
  );
}
