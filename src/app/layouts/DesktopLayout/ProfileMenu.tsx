import { SavedAccountSessionUnavailableError, useAuth, useUserStore } from "@/features/auth";
import { reportSystemError } from "@/features/activity";
import { routes } from "@/features/app-shell";
import { useNativeSessionStore } from "@/features/native-session";
import {
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  MenuItem,
  MenuSubmenu,
} from "@/shared/ui";
import { Check, ExternalLink, LogIn, LogOut, Plus, Repeat2, UserCircle } from "lucide-react";
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

/** The profile button's menu: account actions, and a submenu to switch saved accounts. */
export function ProfileMenu(props: { onClose: () => void; onOpenAccountSettings: () => void }) {
  const navigate = useNavigate();
  const currentPath = useLocation().pathname;
  const currentUser = useNativeSessionStore((state) => state.status?.current_user ?? null);
  const { user, accounts, transitioning, switchAccount, logout } = useAuth();
  const me = useUserStore(
    useShallow((state) => ({ id: state.me?.id, email: state.me?.email, name: state.me?.name })),
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
        navigate("/signin", {
          state: { from: currentPath, addingAccount: true, reauthenticateEmail: email },
        });
        return;
      }
      setSwitchError("The account could not be switched. Try selecting it again.");
      reportSystemError({
        accountId: account?.id,
        scope: "account:switch",
        title: "Account could not be switched",
        error,
        target: { kind: "route", href: currentPath },
      });
    } finally {
      setSwitchingAccountId("");
    }
  };

  const signOut = () => {
    props.onClose();
    void logout().catch((error: unknown) =>
      reportSystemError({
        accountId: account?.id,
        scope: "account:sign-out",
        title: "Could not sign out",
        error,
      }),
    );
  };

  return (
    <DropdownMenuContent align="end" sideOffset={10} width="md" aria-label="Profile">
      <DropdownMenuLabel className="truncate py-1.5 text-xs font-medium text-cream">
        {email || "Not signed in"}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {!account ? (
        <MenuItem icon={<LogIn />} label="Sign in" onSelect={() => navigate(routes.signIn)} />
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
                icon={<Initials>{initialsForProfile(saved.name, saved.email)}</Initials>}
                label={switchingAccountId === saved.id ? "Switching…" : saved.name || saved.email}
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
                navigate("/signin", { state: { from: currentPath, addingAccount: true } })
              }
            />
          </MenuSubmenu>
          <MenuItem icon={<LogOut />} label="Log out" disabled={transitioning} onSelect={signOut} />
        </>
      )}
    </DropdownMenuContent>
  );
}
