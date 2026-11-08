import { accountApi } from "../api/api";
import type { AccountMeResponse } from "../api/accountTypes";
import { AccountDeleteDialog } from "../export/AccountDeleteDialog";
import { useAuth } from "../sessions/authState";
import { openSignInSheet } from "../setup/serverSetup";
import { useUserStore } from "../sessions/useUserStore";
import { Button, ErrorNotification, Input, SkeletonList } from "@/shared/ui";
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
          className="w-[240px] min-w-0"
          value={username}
          disabled={saving}
          onChange={(event) => setUsername(event.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={saving || !next || next === account.username}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </form>
      <ErrorNotification message={error} onDismiss={() => setError("")} />
    </Row>
  );
}

function AccountValue(props: { children: string }) {
  return <span className="select-text text-md leading-6 text-cream-muted">{props.children}</span>;
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
          <Button variant="outline" size="sm" onClick={() => setDeleting(true)}>
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

/** Settings › Profile: the signed-in account, kept on the server and changed here in the app. */
export function AccountSection() {
  const { user } = useAuth();
  const me = useUserStore((state) => state.me);
  const account = user && me?.id === user.id ? me : null;
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    void accountApi
      .me()
      .then((loaded) => useUserStore.getState().setMe(loaded))
      .catch(() => setFailed(true));
  }, []);
  const needsLoad = Boolean(user) && !account;
  useEffect(() => {
    if (needsLoad) load();
  }, [needsLoad, load]);

  if (!user)
    return (
      <Section title="Details">
        <Row label="Not signed in">
          <Button variant="outline" size="sm" onClick={() => openSignInSheet("account")}>
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
          <Button variant="ghost" size="sm" onClick={load}>
            Retry
          </Button>
        }
      >
        Your account couldn't be loaded.
      </DesktopSettingsNotice>
    );
  return (
    <Section title="Details">
      <SkeletonList label="Details" rows={5} leading="none" trailing />
    </Section>
  );
}
