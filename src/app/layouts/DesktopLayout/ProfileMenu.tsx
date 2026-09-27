import { SavedAccountSessionUnavailableError, useAuth, useUserStore } from "@/features/auth";
import { reportSystemError } from "@/features/activity";
import { routes } from "@/features/app-shell";
import { useSetupStore } from "@/features/installer";
import { useTourStore } from "@/features/tour";
import {
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  MenuItem,
  MenuSubmenu,
} from "@/shared/ui";
import { Check, Compass, ExternalLink, LogIn, LogOut, Plus, Repeat2, UserCircle } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { emailName, initialsForProfile } from "./helpers";

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
  const currentUser = useSetupStore((state) => state.status?.current_user ?? null);
  const { user, accounts, transitioning, switchAccount, logout } = useAuth();
  const me = useUserStore(
    useShallow((state) => ({ id: state.me?.id, email: state.me?.email, name: state.me?.name })),
  );
  const [switchingAccountId, setSwitchingAccountId] = useState("");
  const [switchError, setSwitchError] = useState("");
  const account = user ?? currentUser;
  const accountMe = me.id === account?.id ? me : null;
  const email = accountMe?.email ?? account?.email ?? "";
  const displayName = accountMe?.name ?? account?.name ?? emailName(email) ?? "Misty";
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
    <DropdownMenuContent side="right" align="end" sideOffset={10} width="md" aria-label="Profile">
      <DropdownMenuLabel className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-2.5 py-1.5">
        <span className="grid size-8 place-items-center rounded-full bg-charcoal-active text-xs font-bold text-cream">
          {account ? (
            initialsForProfile(displayName, email)
          ) : (
            <UserCircle size={20} strokeWidth={1.75} />
          )}
        </span>
        <span className="min-w-0">
          <strong className="block truncate text-xs font-medium text-cream">{displayName}</strong>
          <small className="block truncate text-[11px] font-normal text-cream-muted">
            {email || "Not signed in"}
          </small>
        </span>
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
          <MenuItem
            icon={<Compass />}
            label="Take workspace tour"
            onSelect={() => useTourStore.getState().resetTour(account?.id)}
          />
          <MenuSubmenu icon={<Repeat2 />} label="Switch accounts" width="lg" disabled={transitioning}>
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
