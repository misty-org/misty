import type { ReactNode } from "react";
import { Settings } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, IconButton, TooltipHint } from "@/shared/ui";
import { ProfileNavButton } from "./NavRail";
import { NowPlayingRail } from "./NowPlayingRail";
import { ProfileMenu } from "./ProfileMenu";

/**
 * The account panel floating in the window's bottom-left corner: the signed-in profile,
 * then now playing, sync and settings as quiet buttons.
 */
export function AccountIsland(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenAccountSettings: () => void;
  syncControl?: ReactNode;
  settingsOpen: boolean;
  onSettingsClick: () => void;
}) {
  return (
    <div
      className={[
        "fixed bottom-2 left-2 z-[60] flex items-center gap-0.5 rounded-xl border border-charcoal-border p-1.5",
        "w-[calc(min(var(--shell-side-tabs,240px),35vw)-16px)] shadow-lg",
        "bg-[var(--misty-window-chrome,var(--color-charcoal-workspace))]",
      ].join(" ")}
      data-misty-window-drag-block="true"
      data-account-island="true"
    >
      <DropdownMenu open={props.open} onOpenChange={props.onOpenChange} modal={false}>
        <TooltipHint content="Profile">
          <DropdownMenuTrigger asChild>
            <ProfileNavButton
              open={props.open}
              showAccountName
              avatarClassName="size-8"
              className={[
                "flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border-0 bg-transparent px-1",
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
      <NowPlayingRail className="size-8" />
      {props.syncControl}
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
