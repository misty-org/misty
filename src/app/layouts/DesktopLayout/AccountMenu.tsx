import {
  openSignInSheet,
  openSignOutSheet,
  SavedAccountSessionUnavailableError,
  useAuth,
  useUserStore,
} from "@/features/account";
import { reportSystemError } from "@/shared/platform/systemErrors";
import { isMistyCloud, useServerChoice } from "@/api/deployment/serverChoice";
import { openOnWebsite } from "@/features/account";
import { routes } from "@/app/shell";
import { useNativeSessionStore } from "@/features/account";
import {
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  MenuItem,
  MenuSubmenu,
  Spinner,
  Surface,
  Text,
} from "@misty/ui";
import { ShortcutText } from "@/features/shortcuts/runtime";
import {
  Check,
  Compass,
  CreditCard,
  LifeBuoy,
  LogOut,
  Plus,
  Repeat2,
  Settings,
  UserCircle,
} from "lucide-react";
import { startTour } from "@/features/onboarding";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { initialsForProfile } from "./accountMenuText";
import { useHelpDialog } from "./HelpDialog";

function Initials(props: { children: string }) {
  return (
    <Surface
      as="span"
      tone="active"
      className="grid size-6 shrink-0 place-items-center rounded-full"
    >
      <Text bare tone="default" className="text-3xs font-bold">
        {props.children}
      </Text>
    </Surface>
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
  // Misty Cloud's plans are bought and changed on the website.
  const cloud = useServerChoice((state) => isMistyCloud(state.choice));
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

  // Plans are bought and changed on the website, which the app opens signed in as this account.
  const openWebsite = (path: string) => {
    props.onClose();
    void openOnWebsite(path).catch((error: unknown) => {
      reportSystemError({
        scope: "account:plan",
        title: "Plan and billing could not be opened",
        error,
      });
    });
  };

  // Signing out asks first, with an option to remove what's on this computer.
  const signOut = () => {
    props.onClose();
    openSignOutSheet();
  };

  return (
    <>
      <DropdownMenuLabel className="py-1.5 text-xs font-medium">
        <Text tone="default">{email || "Not signed in"}</Text>
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
      <MenuItem
        icon={<UserCircle />}
        label="Account settings"
        onSelect={props.onOpenAccountSettings}
      />
      {cloud ? (
        <MenuSubmenu icon={<CreditCard />} label="Plan and billing">
          <MenuItem
            label="Get Misty+ monthly"
            onSelect={() => openWebsite("/pricing?checkout=plus")}
          />
          <MenuItem
            label="Get Misty+ yearly"
            onSelect={() => openWebsite("/pricing?checkout=plus_yearly")}
          />
          <DropdownMenuSeparator />
          <MenuItem label="Manage plan" onSelect={() => openWebsite("/settings/subscription")} />
        </MenuSubmenu>
      ) : null}
      <MenuSubmenu icon={<Repeat2 />} label="Switch accounts" width="lg" disabled={transitioning}>
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
                <Text bare tone="bright">
                  <Check aria-label="Active account" />
                </Text>
              ) : undefined
            }
            onSelect={(event) => {
              event.preventDefault();
              void chooseAccount(saved.id);
            }}
          />
        ))}
        {accounts.length === 0 ? (
          <Text wrap tone="muted" className="m-0 px-2 py-2 text-xs">
            No saved accounts are available yet.
          </Text>
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
      <MenuItem icon={<Compass />} label="Show me around" onSelect={() => startTour()} />
      <MenuItem icon={<LifeBuoy />} label="Help" onSelect={openHelp} />
      <MenuItem icon={<LogOut />} label="Sign out…" disabled={transitioning} onSelect={signOut} />
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
