import {
  openSignInSheet,
  openSignOutSheet,
  SavedAccountSessionUnavailableError,
  useAuth,
  useUserStore,
} from "@/features/auth";
import { reportSystemError } from "@/features/support/systemErrors";
import { routes } from "@/features/app-shell";
import { useNativeSessionStore } from "@/features/native-session";
import {
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  MenuItem,
  MenuSubmenu,
} from "@/shared/ui";
import { ShortcutText } from "@/features/shortcuts/runtime";
import {
  Check,
  ExternalLink,
  LogIn,
  LogOut,
  Plus,
  Repeat2,
  Settings,
  UserCircle,
} from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { initialsForProfile } from "./helpers";

function Initials(props: { children: string }) {
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-charcoal-active text-[10px] font-bold text-cream">
      {props.children}
    </span>
  );
}

/** The profile menu's rows: this device's Settings, account actions, and a submenu to switch
 * saved accounts. */
function ProfileMenuItems(props: {
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
  const [switchError, setSwitchError] = useState("");
  const account = user ?? currentUser;
  const accountMe = me.id === account?.id ? me : null;
  const email = accountMe?.email ?? account?.email ?? "";
  const busy = Boolean(switchingAccountId) || transitioning;

  const chooseAccount = async (accountId: string) => {
    if (accountId === account?.id || busy) return;
    setSwitchError("");
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
      setSwitchError("The account could not be switched. Try selecting it again.");
      reportSystemError({
        scope: "account:switch",
        title: "Account could not be switched",
        error,
      });
    } finally {
      setSwitchingAccountId("");
    }
  };

  // Signing out asks first: it keeps browsing, with an option to remove this device's data.
  const signOut = () => {
    props.onClose();
    openSignOutSheet();
  };

  return (
    <>
      <DropdownMenuLabel className="truncate py-1.5 text-xs font-medium text-cream">
        {email || "Not signed in"}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {props.onOpenSettings ? (
        <MenuItem
          icon={<Settings />}
          label="Settings"
          shortcut={<ShortcutText commandId="app.open_settings" />}
          onSelect={props.onOpenSettings}
        />
      ) : null}
      {!account ? (
        <MenuItem icon={<LogIn />} label="Sign in" onSelect={() => openSignInSheet("account")} />
      ) : (
        <>
          <MenuItem
            icon={<UserCircle />}
            // This leaves the app for the browser, so say so rather than surprising people.
            label={
              <>
                Account settings<span className="sr-only"> (opens in your browser)</span>
              </>
            }
            shortcut={<ExternalLink className="size-3.5" aria-hidden="true" />}
            onSelect={props.onOpenAccountSettings}
          />
          <MenuSubmenu
            icon={<Repeat2 />}
            label="Switch accounts"
            width="lg"
            disabled={transitioning}
          >
            <DropdownMenuLabel>Switch accounts</DropdownMenuLabel>
            {switchError ? (
              <p role="alert" className="m-0 px-2 py-1 text-xs text-cream-muted">
                {switchError}
              </p>
            ) : null}
            {accounts.map((saved) => (
              <MenuItem
                key={saved.id}
                title={saved.email}
                disabled={busy}
                icon={<Initials>{initialsForProfile(saved.username, saved.email)}</Initials>}
                label={
                  switchingAccountId === saved.id ? "Switching…" : saved.username || saved.email
                }
                shortcut={
                  saved.id === account?.id ? (
                    <Check className="size-3.5 text-sage-fg" aria-label="Active account" />
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

/** The profile button's menu. */
export function ProfileMenu(props: {
  onClose: () => void;
  onOpenAccountSettings: () => void;
  onOpenSettings?: () => void;
}) {
  return (
    <DropdownMenuContent align="end" sideOffset={10} width="md" aria-label="Profile">
      <ProfileMenuItems {...props} />
    </DropdownMenuContent>
  );
}
