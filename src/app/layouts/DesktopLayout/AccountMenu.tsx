import {
  openSignInSheet,
  openSignOutSheet,
  SavedAccountSessionUnavailableError,
  useAccountBannerUrl,
  useAuth,
  useUserStore,
} from "@/features/account";
import { useStatusStore } from "@/features/direct";
import { reportSystemError } from "@/shared/platform/system_errors";
import { isMistyCloud, useServerChoice } from "@/api/deployment/server_choice";
import { openOnWebsite } from "@/features/account";
import { routes } from "@/app/shell";
import { useNativeSessionStore } from "@/features/account";
import {
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  MenuItem,
  MenuSubmenu,
  PresenceFace,
  ProfileCardBanner,
  ProfileCardGroup,
  ProfileCardHeader,
  ProfileCardName,
  ProfileCardStatus,
  Spinner,
  Surface,
  Text,
} from "@misty/ui";
import { ShortcutText } from "@/features/shortcuts/Runtime";
import {
  Check,
  CreditCard,
  LifeBuoy,
  LogOut,
  Plus,
  Repeat2,
  Settings,
  UserCircle,
} from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { emailName, initialsForProfile } from "./account_menu_text";
import { AccountAvatar } from "./NavRail";
import { StatusSubmenu, useMyShownPresence } from "./StatusMenu";
import { useHelpDialog } from "./HelpDialog";

function Initials(props: { children: string }) {
  return (
    <Surface
      as="span"
      tone="active"
      className="grid size-6 shrink-0 place-items-center rounded-full"
    >
      <Text bare tone="default" className="text-micro font-bold">
        {props.children}
      </Text>
    </Surface>
  );
}

interface AccountMenuProps {
  onClose: () => void;
  onOpenAccountSettings: () => void;
  onOpenSettings?: () => void;
  onChangeBanner: () => void;
  onCustomStatus: () => void;
}

function AccountMenuItems(props: AccountMenuProps) {
  const navigate = useNavigate();
  const currentPath = useLocation().pathname;
  const cloud = useServerChoice((state) => isMistyCloud(state.choice));
  const currentUser = useNativeSessionStore((state) => state.status?.current_user ?? null);
  const { user, accounts, transitioning, switchAccount } = useAuth();
  const me = useUserStore(
    useShallow((state) => ({
      id: state.me?.id,
      email: state.me?.email,
      username: state.me?.username,
      bannerVersion: state.me?.banner_version ?? 0,
    })),
  );
  const presence = useMyShownPresence();
  const status = useStatusStore((state) => state.mine);
  const [switchingAccountId, setSwitchingAccountId] = useState("");
  const account = user ?? currentUser;
  const accountMe = me.id === account?.id ? me : null;
  const email = accountMe?.email ?? account?.email ?? "";
  const name = accountMe?.username || account?.username || emailName(email) || "Misty";
  const bannerUrl = useAccountBannerUrl(account?.id, accountMe?.bannerVersion);
  const busy = Boolean(switchingAccountId) || transitioning;

  const chooseAccount = async (accountId: string) => {
    if (accountId === account?.id || busy) return;
    setSwitchingAccountId(accountId);
    try {
      props.onClose();
      await switchAccount(accountId);
    } catch (error) {
      if (error instanceof SavedAccountSessionUnavailableError) {
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

  const openHelp = () => {
    props.onClose();
    window.setTimeout(() => useHelpDialog.getState().setOpen(true), 0);
  };

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

  const signOut = () => {
    props.onClose();
    openSignOutSheet();
  };

  return (
    <>
      <ProfileCardBanner src={bannerUrl || null} onChange={props.onChangeBanner} />
      <ProfileCardHeader
        face={
          <PresenceFace presence={presence} face="xl">
            <AccountAvatar size="xl" shape="circle" />
          </PresenceFace>
        }
        status={
          <ProfileCardStatus
            emoji={status.custom_emoji}
            text={status.custom_text}
            onSelect={() => window.setTimeout(props.onCustomStatus, 0)}
          />
        }
      />
      <ProfileCardName name={name} line={email || undefined} />
      <ProfileCardGroup>
        <MenuItem
          icon={<UserCircle />}
          label="Account settings"
          onSelect={props.onOpenAccountSettings}
        />
        <StatusSubmenu onCustomStatus={props.onCustomStatus} />
        {props.onOpenSettings ? (
          <MenuItem
            icon={<Settings />}
            label="Settings"
            shortcut={<ShortcutText commandId="app.open_settings" />}
            onSelect={props.onOpenSettings}
          />
        ) : null}
      </ProfileCardGroup>
      {cloud ? (
        <ProfileCardGroup>
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
        </ProfileCardGroup>
      ) : null}
      <ProfileCardGroup>
        <MenuItem icon={<LifeBuoy />} label="Help" onSelect={openHelp} />
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
            <Text wrap size="meta" tone="muted" className="m-0 px-2 py-2">
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
        <MenuItem icon={<LogOut />} label="Sign out…" disabled={transitioning} onSelect={signOut} />
      </ProfileCardGroup>
    </>
  );
}

export function AccountMenu(props: AccountMenuProps) {
  return (
    <DropdownMenuContent kind="card" side="top" align="start" sideOffset={9} aria-label="Account">
      <AccountMenuItems {...props} />
    </DropdownMenuContent>
  );
}
