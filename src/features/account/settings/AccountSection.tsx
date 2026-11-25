import { accountApi } from "../api/api";
import type { AccountMeResponse } from "../api/account_types";
import { AccountDeleteDialog } from "../export/AccountDeleteDialog";
import { useAuth } from "../sessions/auth_state";
import { openSignInSheet } from "../setup/server_setup";
import { useUserStore } from "../sessions/use_user_store";
import { Button, Input, Text, useNotice } from "@misty/ui";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  DesktopSettingsNotice,
  DesktopSettingsRow as Row,
  DesktopSettingsRowSkeleton,
} from "@/features/settings";
import { AccountBannerRow } from "./AccountBannerRow";
import { AccountPictureRow } from "./AccountPictureRow";

function UsernameRow({ account }: { account: AccountMeResponse }) {
  const [username, setUsername] = useState(account.username);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const next = username.trim();
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !next || next === account.username) return;
    setSaving(true);
    setError("");
    try {
      const saved = await accountApi.updateUsername(next);
      setUsername(saved.username);
      useUserStore.getState().patchMe({ username: saved.username });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your username couldn't be saved.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Row label="Username">
      <form className="flex min-w-0 items-center gap-2" onSubmit={(event) => void save(event)}>
        <Input
          aria-label="Username"
          autoComplete="username"
          className="w-60 min-w-0"
          value={username}
          disabled={saving}
          onChange={(event) => setUsername(event.target.value)}
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={!next || next === account.username || saving}
        >
          Save
        </Button>
      </form>
    </Row>
  );
}

function AccountValue(props: { children: string }) {
  return (
    <Text bare size="control" tone="muted" className="select-text">
      {props.children}
    </Text>
  );
}

function AccountDetails({ account }: { account: AccountMeResponse }) {
  return (
    <>
      <AccountPictureRow account={account} />
      <AccountBannerRow account={account} />
      <UsernameRow account={account} />
      <Row label="Email">
        <AccountValue>{account.email}</AccountValue>
      </Row>
      <Row label="Member since">
        <AccountValue>
          {new Date(account.created_at).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </AccountValue>
      </Row>
      <Row label="User ID">
        <AccountValue>{account.id}</AccountValue>
      </Row>
    </>
  );
}

function useShownAccount() {
  const { user } = useAuth();
  const me = useUserStore((state) => state.me);
  return user && me?.id === user.id ? me : null;
}

export function AccountRemovalSection() {
  const account = useShownAccount();
  const { logout } = useAuth();
  const [deleting, setDeleting] = useState(false);
  if (!account) return null;
  return (
    <Row label="Delete account" description="Removed after 30 days.">
      <Button variant="secondary" onClick={() => setDeleting(true)}>
        Delete…
      </Button>
      <AccountDeleteDialog
        open={deleting}
        onOpenChange={setDeleting}
        email={account.email}
        google={account.provider === "google"}
        onDeleted={() => void logout().catch(() => undefined)}
      />
    </Row>
  );
}

export function AccountSection() {
  const { user } = useAuth();
  const account = useShownAccount();
  const [failed, setFailed] = useState(false);
  const userId = user?.id;
  const load = useCallback(() => {
    if (!userId) return;
    setFailed(false);
    const matches = (loaded: AccountMeResponse) => loaded.id === userId;
    void accountApi
      .meCached((saved) => {
        const shown = useUserStore.getState().me;
        if (matches(saved) && shown?.id !== userId) useUserStore.getState().setMe(saved);
      })
      .then((loaded) => {
        if (matches(loaded)) useUserStore.getState().setMe(loaded);
      })
      .catch(() => setFailed(true));
  }, [userId]);
  useEffect(() => {
    load();
  }, [load]);

  if (!user)
    return (
      <Row label="Not signed in">
        <Button variant="secondary" onClick={() => openSignInSheet("account")}>
          Sign in
        </Button>
      </Row>
    );
  if (account) return <AccountDetails key={account.id} account={account} />;
  if (failed)
    return (
      <DesktopSettingsNotice
        action={
          <Button variant="quiet" onClick={load}>
            Retry
          </Button>
        }
      >
        Your account couldn't be loaded.
      </DesktopSettingsNotice>
    );
  return <DesktopSettingsRowSkeleton label="Details" rows={6} control={["field", "button"]} />;
}
