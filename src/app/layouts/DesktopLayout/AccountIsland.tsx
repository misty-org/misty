import { Settings } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
  useNotice,
} from "@/shared/ui";
import { preloadSettingsWorkspace } from "@/features/settings";
import { AccountNavButton } from "./NavRail";
import { AccountMenu } from "./AccountMenu";

// As wide as the name needs, shrinking to truncate a long one. The padding keeps the avatar and the
// name clear of the edges of the hover wash.
const rowButtonClass = [
  "flex h-8 min-w-0 shrink items-center gap-2 rounded-lg border-0 bg-transparent py-0 pr-2.5 pl-1",
  "text-sm font-medium text-cream hover:bg-control-hover",
].join(" ");

/**
 * The sidebar's closing row, inside its panel: the signed-in account, then Agents and Settings as
 * quiet buttons. Signed out, the account is a Sign in button, and Agents still opens: agents need no
 * account. An expired session looks the same, and a notice says why: nothing on this computer is
 * removed, and signing in brings the account back.
 */
export function AccountIsland(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenAccountSettings: () => void;
  settingsOpen: boolean;
  onSettingsClick: () => void;
  /** Nobody is signed in: Misty is browsing with no account. */
  signedOut?: boolean;
  /** The server rejected the account's session. */
  sessionExpired?: boolean;
  /** Opens the sign-in sheet; `again` signs the current account in again. */
  onSignIn: (again: boolean) => void;
}) {
  const expired = Boolean(props.sessionExpired);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  useEffect(() => {
    if (!expired) setNoticeDismissed(false);
  }, [expired]);
  useNotice(expired && !noticeDismissed, {
    message: "You've been signed out. Sign in to get your Spaces and sync back.",
    action: {
      label: "Sign in",
      onSelect: () => {
        setNoticeDismissed(true);
        props.onSignIn(true);
      },
    },
    onDismiss: () => setNoticeDismissed(true),
  });
  return (
    <div
      className="misty-sidebar-account"
      data-browser-toolbar
      data-sidebar
      data-misty-window-drag-block="true"
      data-account-island="true"
      data-tour="account"
    >
      {props.signedOut || expired ? (
        <Button
          variant="quiet"
          className="mr-auto h-7 border-0 px-2 text-cream"
          onClick={() => props.onSignIn(expired)}
        >
          Sign in
        </Button>
      ) : (
        <DropdownMenu open={props.open} onOpenChange={props.onOpenChange} modal={false}>
          <Tooltip content="Account">
            <DropdownMenuTrigger asChild>
              <AccountNavButton
                open={props.open}
                showAccountName
                avatarClassName="size-6"
                className={rowButtonClass}
              />
            </DropdownMenuTrigger>
          </Tooltip>
          <AccountMenu
            onClose={() => props.onOpenChange(false)}
            onOpenAccountSettings={props.onOpenAccountSettings}
          />
        </DropdownMenu>
      )}
      <IconButton
        label="Settings"
        className="ml-auto"
        aria-pressed={props.settingsOpen}
        onPointerEnter={() => void preloadSettingsWorkspace().catch(() => undefined)}
        onFocus={() => void preloadSettingsWorkspace().catch(() => undefined)}
        onClick={props.onSettingsClick}
      >
        <Settings />
      </IconButton>
    </div>
  );
}
