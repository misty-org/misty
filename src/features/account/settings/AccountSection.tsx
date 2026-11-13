import { accountApi } from "../api/api";
import type { AccountMeResponse } from "../api/accountTypes";
import { AccountDeleteDialog } from "../export/AccountDeleteDialog";
import { useAuth } from "../sessions/authState";
import { openSignInSheet } from "../setup/serverSetup";
import { useUserStore } from "../sessions/useUserStore";
import { Button, cn, Input, Skeleton, SkeletonControl, Text, useNotice } from "@/shared/ui";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  DesktopSettingsNotice,
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "@/features/settings";
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
          disabled={!next || next === account.username}
          loading={saving}
        >
          Save
        </Button>
      </form>
    </Row>
  );
}

function AccountValue(props: { children: string }) {
  return (
    <Text bare tone="muted" className="select-text text-md leading-6">
      {props.children}
    </Text>
  );
}

function SignedInAccount({ account }: { account: AccountMeResponse }) {
  const { logout } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const google = account.provider === "google";
  return (
    <>
      <Section title="Details">
        <AccountPictureRow account={account} />
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
      </Section>

      <Section title="Danger">
        <Row label="Delete account" description="Removed after 30 days.">
          <Button variant="secondary" onClick={() => setDeleting(true)}>
            Delete…
          </Button>
          <AccountDeleteDialog
            open={deleting}
            onOpenChange={setDeleting}
            email={account.email}
            google={google}
            // The account is on its way out, so a sign-out that fails changes nothing.
            onDeleted={() => void logout().catch(() => undefined)}
          />
        </Row>
      </Section>
    </>
  );
}

/**
 * The Details and Danger sections on a first load, row for row: the picture with Change, the
 * username field with Save, three values, and Delete. The first row names what is loading for
 * screen readers, as the panel insets only its direct rows.
 */
function AccountSkeleton() {
  const row = "grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-8 py-3";
  const label = (width: string) => (
    <div className="flex h-6 items-center">
      <Skeleton className={cn("h-4", width)} />
    </div>
  );
  const value = (width: string) => (
    <div className="flex h-6 items-center">
      <Skeleton className={cn("h-3.5", width)} />
    </div>
  );
  return (
    <>
      <Section title="Details">
        {/* An empty label keeps the panel's padding and hairlines without naming a setting. */}
        <div
          data-setting-label=""
          role="status"
          aria-label="Details"
          aria-busy="true"
          className={row}
        >
          {label("w-16")}
          <div className="flex items-center justify-end gap-2">
            <Skeleton className="size-10 rounded-full" />
            <SkeletonControl kind="button" />
          </div>
        </div>
        <div data-setting-label="" className={row}>
          {label("w-20")}
          <div className="flex items-center justify-end gap-2">
            <SkeletonControl kind="field" />
            <SkeletonControl kind="button" className="w-14" />
          </div>
        </div>
        <div data-setting-label="" className={row}>
          {label("w-12")}
          {value("w-48")}
        </div>
        <div data-setting-label="" className={row}>
          {label("w-28")}
          {value("w-32")}
        </div>
        <div data-setting-label="" className={row}>
          {label("w-16")}
          {value("w-64")}
        </div>
      </Section>
      <Section title="Danger">
        <div data-setting-label="" className={row}>
          <div className="grid min-w-0 gap-1">
            {label("w-28")}
            {value("w-36")}
          </div>
          <SkeletonControl kind="button" />
        </div>
      </Section>
    </>
  );
}

/**
 * Settings › Profile: the signed-in account, kept on the server and changed here in the app. The
 * copy saved for this account paints at once and the server's answer replaces it behind.
 */
export function AccountSection() {
  const { user } = useAuth();
  const me = useUserStore((state) => state.me);
  const account = user && me?.id === user.id ? me : null;
  const [failed, setFailed] = useState(false);
  const userId = user?.id;
  const load = useCallback(() => {
    if (!userId) return;
    setFailed(false);
    const matches = (loaded: AccountMeResponse) => loaded.id === userId;
    void accountApi
      .meCached((saved) => {
        // The saved copy only fills an empty page; anything already shown is newer.
        const shown = useUserStore.getState().me;
        if (matches(saved) && shown?.id !== userId) useUserStore.getState().setMe(saved);
      })
      .then((loaded) => {
        if (matches(loaded)) useUserStore.getState().setMe(loaded);
      })
      // A failed refresh keeps the account on screen; it only matters when nothing is shown.
      .catch(() => setFailed(true));
  }, [userId]);
  useEffect(() => {
    load();
  }, [load]);

  if (!user)
    return (
      <Section title="Details">
        <Row label="Not signed in">
          <Button variant="secondary" onClick={() => openSignInSheet("account")}>
            Sign in
          </Button>
        </Row>
      </Section>
    );
  if (account) return <SignedInAccount key={account.id} account={account} />;
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
  return <AccountSkeleton />;
}
