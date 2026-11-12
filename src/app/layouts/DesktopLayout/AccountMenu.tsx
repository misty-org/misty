import {
  openSignInSheet,
  openSignOutSheet,
  SavedAccountSessionUnavailableError,
  useAuth,
  useUserStore,
} from "@/features/account";
import { reportSystemError } from "@/shared/platform/systemErrors";
import { routes } from "@/app/shell";
import { useNativeSessionStore } from "@/features/account";
import {
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  MenuItem,
  MenuSubmenu,
  OverflowFadeText,
  Spinner,
} from "@/shared/ui";
import { ShortcutText } from "@/features/shortcuts/runtime";
import { Check, LifeBuoy, LogIn, LogOut, Plus, Repeat2, Settings, UserCircle } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { initialsForProfile } from "./accountMenuText";
import { useHelpDialog } from "./HelpDialog";

function Initials(props: { children: string }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-charcoal-active text-3xs font-bold text-cream">
      {props.children}
    </span>
  );
}

/** The account menu's rows: Settings, account actions, a submenu to switch saved accounts, and
 * Help. */
function AccountMenuItems(props: {
  onClose: () => void;
  onOpenAccountSettings: () => void;
  /** Opens Settings; the avatar holds it so the window's corner needs no gear of its own. */
  onOpenSettings?: () => void;
}) {
  const navigate = useNavigate();
  const currentPath = useLocation().pathname;
  const currentUser = useNativeSessionStore((state) => state.status?.current_user ?? null);
  const { user, accounts, transitioning, switchAccount } = useAuth();
  const me = useUserStore(
    useShallow((state) => ({
      id: state.me?.id,
      email: state.me?.email,
      username: state.me?.username,
    })),
  );
  const [switchingAccountId, setSwitchingAccountId] = useState("");
  const account = user ?? currentUser;
  const accountMe = me.id === account?.id ? me : null;
  const email = accountMe?.email ?? account?.email ?? "";
  const busy = Boolean(switchingAccountId) || transitioning;

  const chooseAccount = async (accountId: string) => {
    if (accountId === account?.id || busy) return;
    setSwitchingAccountId(accountId);
    try {
      props.onClose();
      await switchAccount(accountId);
    } catch (error) {
      if (error instanceof SavedAccountSessionUnavailableError) {
        // The account stays listed; its session just needs a password again.
        const email = accounts.find((saved) => saved.id === accountId)?.email ?? "";
        openSignInSheet("expired", email);
        return;
      }
      reportSystemError({
        scope: "account:switch",
        title: "Account could not be switched",
        error,
      });
    } finally {
      setSwitchingAccountId("");
    }
  };

  // The menu hands focus back as it closes, so the dialog opens after it.
  const openHelp = () => {
    props.onClose();
    window.setTimeout(() => useHelpDialog.getState().setOpen(true), 0);
  };

  // Signing out asks first, with an option to remove what's on this computer.
  const signOut = () => {
    props.onClose();
    openSignOutSheet();
  };

  return (
    <>
      <DropdownMenuLabel className="py-1.5 text-xs font-medium text-cream">
        <OverflowFadeText>{email || "Not signed in"}</OverflowFadeText>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {props.onOpenSettings ? (
        <>
          <MenuItem
            icon={<Settings />}
            label="Settings"
            shortcut={<ShortcutText commandId="app.open_settings" />}
            onSelect={props.onOpenSettings}
          />
          <DropdownMenuSeparator />
        </>
      ) : null}
      {!account ? (
        <MenuItem icon={<LogIn />} label="Sign in" onSelect={() => openSignInSheet("account")} />
      ) : (
        <>
          <MenuItem
            icon={<UserCircle />}
            label="Account settings"
            onSelect={props.onOpenAccountSettings}
          />
          <MenuSubmenu
            icon={<Repeat2 />}
            label="Switch accounts"
            width="lg"
            disabled={transitioning}
          >
            <DropdownMenuLabel>Switch accounts</DropdownMenuLabel>
            {accounts.map((saved) => (
              <MenuItem
                key={saved.id}
                disabled={busy}
                icon={<Initials>{initialsForProfile(saved.username, saved.email)}</Initials>}
                label={saved.username || saved.email}
                shortcut={
                  switchingAccountId === saved.id ? (
                    <Spinner size="sm" label="Switching account" />
                  ) : saved.id === account?.id ? (
                    <Check className="size-3.5 text-cream-bright" aria-label="Active account" />
                  ) : undefined
                }
                onSelect={(event) => {
                  event.preventDefault();
                  void chooseAccount(saved.id);
                }}
              />
            ))}
            {accounts.length === 0 ? (
              <p className="m-0 px-2 py-2 text-xs text-cream-muted">
                No saved accounts are available yet.
              </p>
            ) : null}
            <DropdownMenuSeparator />
            <MenuItem
              icon={<Plus />}
              label="Add another account"
              disabled={busy}
              onSelect={() =>
                navigate(routes.welcome, { state: { from: currentPath, addingAccount: true } })
              }
            />
          </MenuSubmenu>
          <MenuItem icon={<LifeBuoy />} label="Help" onSelect={openHelp} />
          <MenuItem
            icon={<LogOut />}
            label="Sign out…"
            disabled={transitioning}
            onSelect={signOut}
          />
        </>
      )}
    </>
  );
}

/** The account button's menu. */
export function AccountMenu(props: {
  onClose: () => void;
  onOpenAccountSettings: () => void;
  onOpenSettings?: () => void;
}) {
  return (
    <DropdownMenuContent align="end" sideOffset={10} width="md" aria-label="Account">
      <AccountMenuItems {...props} />
    </DropdownMenuContent>
  );
}
