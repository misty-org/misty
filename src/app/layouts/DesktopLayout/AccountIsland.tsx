import { Settings, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  IconButton,
  toolbarIconProps,
  TooltipHint,
} from "@/shared/ui";
import { preloadSettingsWorkspace } from "@/features/settings";
import { ProfileNavButton } from "./NavRail";
import { ProfileMenu } from "./ProfileMenu";

const rowButtonClass = [
  "flex h-7 min-w-0 flex-1 items-center gap-2 rounded-lg border-0 bg-transparent px-0",
  "text-sm font-medium text-cream hover:bg-control-hover",
].join(" ");

/**
 * The sidebar's closing row, inside its panel: the signed-in profile, then Sync and Settings
 * as quiet buttons. Signed out, the profile is a Sign in button and there is no Sync; an
 * expired session swaps Sync for Sign in again.
 */
export function AccountIsland(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenAccountSettings: () => void;
  settingsOpen: boolean;
  onSettingsClick: () => void;
  /** Nobody is signed in: Misty is browsing on the local profile. */
  signedOut?: boolean;
  /** The server rejected the account's session. */
  sessionExpired?: boolean;
  /** Opens the sign-in sheet; `again` signs the current account in again. */
  onSignIn: (again: boolean) => void;
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
      {props.signedOut ? (
        <Button
          variant="ghost"
          type="button"
          className={rowButtonClass}
          onClick={() => props.onSignIn(false)}
        >
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-md border border-charcoal-border-strong text-cream-muted"
          >
            <UserRound {...toolbarIconProps} className="size-4" />
          </span>
          <span className="truncate">Sign in</span>
        </Button>
      ) : (
        <DropdownMenu open={props.open} onOpenChange={props.onOpenChange} modal={false}>
          <TooltipHint content="Profile">
            <DropdownMenuTrigger asChild>
              <ProfileNavButton
                open={props.open}
                showAccountName
                avatarClassName="size-7"
                className={rowButtonClass}
              />
            </DropdownMenuTrigger>
          </TooltipHint>
          <ProfileMenu
            onClose={() => props.onOpenChange(false)}
            onOpenAccountSettings={props.onOpenAccountSettings}
          />
        </DropdownMenu>
      )}
      {props.sessionExpired ? (
        <Button variant="ghost" size="sm" type="button" onClick={() => props.onSignIn(true)}>
          Sign in again
        </Button>
      ) : (
        props.sync
      )}
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
