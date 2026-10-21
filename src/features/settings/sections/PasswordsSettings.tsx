import { Copy, Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/features/auth";
import { SyncUnlockForm } from "@/features/browser-workspace/SyncAccountSettings";
import { useSyncController } from "@/features/browser-workspace/useSyncController";
import { PasswordEditor } from "@/features/passwords/PasswordEditor";
import { passwordsApi, siteLabel, type SavedLogin } from "@/features/passwords/api";
import { confirmAction } from "@/shared/lib/confirmAction";
import { Button, IconButton, Input, SkeletonList } from "@/shared/ui";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { SettingsNote } from "../SettingsControls";

/** Saved sign-ins, sealed in the sync vault. A password is read only when you ask for it. */
export function PasswordsSettings() {
  const { user } = useAuth();
  const sync = useSyncController(user?.id ?? "");
  const unlocked = Boolean(sync.session);
  const [logins, setLogins] = useState<SavedLogin[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedLogin | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      setLogins(await passwordsApi.list());
      setError(null);
    } catch (reason) {
      setError(String(reason));
    }
  }, []);
  useEffect(() => {
    if (unlocked) void load();
  }, [unlocked, load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (logins ?? []).filter(
      (login) =>
        !needle || `${login.origin} ${login.username}`.toLocaleLowerCase().includes(needle),
    );
  }, [logins, query]);

  if (!unlocked)
    return (
      <SettingsSectionBlock
        title="Saved passwords"
        description="Passwords are encrypted with your sync vault, which belongs to your account."
      >
        {sync.accountId ? (
          <SyncUnlockForm controller={sync} sectionTitle="Unlock your sync vault" />
        ) : (
          <SettingsNote>Sign in to Misty to save and fill passwords.</SettingsNote>
        )}
      </SettingsSectionBlock>
    );

  return (
    <SettingsSectionBlock
      title="Saved passwords"
      description="Misty asks before saving a sign-in and offers it again on the site it belongs to."
    >
      <div className="flex items-center gap-2 pb-3">
        <Input
          aria-label="Search passwords"
          placeholder="Search passwords"
          value={query}
          className="min-w-0 flex-1"
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
          Add password
        </Button>
      </div>
      {editing ? (
        <PasswordEditor
          login={editing === "new" ? null : editing}
          onDone={(saved) => {
            setEditing(null);
            if (saved) void load();
          }}
        />
      ) : null}
      {error ? <SettingsNote>{error}</SettingsNote> : null}
      {logins === null && !error ? (
        <SkeletonList label="Saved passwords" rows={4} leading="none" trailing />
      ) : null}
      {logins !== null && !visible.length ? (
        <SettingsNote>{query ? "No passwords match." : "No saved passwords yet."}</SettingsNote>
      ) : null}
      {visible.map((login) => (
        <PasswordRow
          key={login.id}
          login={login}
          onEdit={() => setEditing(login)}
          onRemoved={() => void load()}
          onError={setError}
        />
      ))}
    </SettingsSectionBlock>
  );
}

function PasswordRow(props: {
  login: SavedLogin;
  onEdit(): void;
  onRemoved(): void;
  onError(message: string): void;
}) {
  const { login } = props;
  const [password, setPassword] = useState<string | null>(null);
  const attempt = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (reason) {
      props.onError(String(reason));
    }
  };
  const site = siteLabel(login.origin);
  return (
    <SettingsRow
      label={site}
      description={
        <span data-private="true" className="ph-no-capture">
          {login.username || "No username"}
          {password !== null ? <span className="ml-2 font-mono text-cream">{password}</span> : null}
        </span>
      }
    >
      <IconButton
        size="xs"
        label={password !== null ? `Hide password for ${site}` : `Show password for ${site}`}
        onClick={() =>
          void attempt(async () =>
            setPassword(password !== null ? null : await passwordsApi.reveal(login.id)),
          )
        }
      >
        {password !== null ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </IconButton>
      <IconButton
        size="xs"
        label={`Copy password for ${site}`}
        onClick={() =>
          void attempt(async () =>
            navigator.clipboard.writeText(await passwordsApi.reveal(login.id)),
          )
        }
      >
        <Copy className="size-3.5" />
      </IconButton>
      <IconButton size="xs" label={`Edit ${site}`} onClick={props.onEdit}>
        <Pencil className="size-3.5" />
      </IconButton>
      <IconButton
        size="xs"
        label={`Delete ${site}`}
        onClick={() =>
          void attempt(async () => {
            if (!(await confirmAction(`Delete the saved password for ${site}?`))) return;
            await passwordsApi.remove(login.id);
            props.onRemoved();
          })
        }
      >
        <Trash2 className="size-3.5" />
      </IconButton>
    </SettingsRow>
  );
}
