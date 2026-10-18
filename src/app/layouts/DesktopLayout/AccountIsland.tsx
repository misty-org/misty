import { Bot, Settings } from "lucide-react";
import { useMistyPanelStore } from "@/features/agents";
import { showAgentsPanel } from "@/features/browser/workspace/BrowserMistyPanel";
import {
  appIcon,
  DropdownMenu,
  DropdownMenuTrigger,
  IconButton,
  toolbarIconProps,
  TooltipHint,
} from "@/shared/ui";
import { ProfileNavButton } from "./NavRail";
import { ProfileMenu } from "./ProfileMenu";

const AgentsIcon = appIcon("agents") ?? Bot;

/** Agents in a side panel beside the page; pressed while that panel is open. */
function AgentsPanelButton() {
  const shown = useMistyPanelStore((s) => s.open);
  return (
    <IconButton label="Agents" aria-pressed={shown} onClick={showAgentsPanel}>
      {/* Fills its box like the gear, so the sidebar draws it a size down too. */}
      <AgentsIcon {...toolbarIconProps} className="size-4" />
    </IconButton>
  );
}

/**
 * The sidebar's closing row, inside its panel: the signed-in profile, then Agents and
 * Settings as quiet buttons.
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
      <AgentsPanelButton />
      <IconButton
        label="Settings"
        aria-pressed={props.settingsOpen}
        onClick={props.onSettingsClick}
      >
        {/* A round glyph: the sidebar draws it a size down so it reads like the line icons. */}
        <Settings {...toolbarIconProps} className="size-4" />
      </IconButton>
    </div>
  );
}

/**
 * With the sidebar collapsed the account ends the tab strip beside the Space: just the
 * avatar. Settings is in its menu, and Agents sits beside Chat in the page's toolbar.
 */
export function AccountTab(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenAccountSettings: () => void;
  settingsOpen: boolean;
  onSettingsClick: () => void;
}) {
  return (
    <div
      className="misty-workspace-space flex shrink-0 items-center self-stretch pl-1"
      data-browser-toolbar
      data-misty-window-drag-block="true"
      data-account-tab="true"
    >
      <DropdownMenu open={props.open} onOpenChange={props.onOpenChange} modal={false}>
        <TooltipHint content="Profile">
          <DropdownMenuTrigger asChild>
            <ProfileNavButton
              open={props.open}
              avatarClassName="size-5"
              className="grid size-8 shrink-0 place-items-center rounded-lg p-0 hover:bg-control-hover data-[state=open]:bg-control-hover"
            />
          </DropdownMenuTrigger>
        </TooltipHint>
        <ProfileMenu
          onClose={() => props.onOpenChange(false)}
          onOpenAccountSettings={props.onOpenAccountSettings}
          onOpenSettings={() => {
            props.onOpenChange(false);
            props.onSettingsClick();
          }}
        />
      </DropdownMenu>
    </div>
  );
}
