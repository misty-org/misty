import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
import { passwordsApi, siteLabel, type SavedLogin } from "@/features/passwords/api";
import { useBrowserSyncStore } from "@/features/browser-workspace/store";
import { Button, IconButton, Input, SkeletonList } from "@/shared/ui";
import {
  DesktopSettingsNotice,
  DesktopSettingsRow,
  DesktopSettingsSection,
} from "../components/DesktopSettingsUI";
import { SettingsNote } from "../SettingsControls";
import { useSettingsStore } from "../store/useSettingsStore";

/** Saved sign-ins, sealed in the sync vault. Passwords are read only on request. */
export function PasswordsSettings() {
  const unlocked = useBrowserSyncStore((state) => Boolean(state.session));
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
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (logins ?? []).filter(
      (login) =>
        !needle || `${login.origin} ${login.username}`.toLocaleLowerCase().includes(needle),
    );
  }, [logins, query]);

  if (!unlocked)
    return (
      <DesktopSettingsSection title="Passwords">
        <SettingsNote>
          Saved passwords are encrypted with your sync vault. Unlock it in Sync to see and fill
          them.
        </SettingsNote>
        <div className="border-t border-charcoal-border py-3">
          <Button
            variant="outline"
            onClick={() => useSettingsStore.getState().setActiveSection("sync")}
          >
            Open Sync
          </Button>
        </div>
      </DesktopSettingsSection>
    );

  return (
    <>
      {error ? <DesktopSettingsNotice>{error}</DesktopSettingsNotice> : null}
      <DesktopSettingsSection
        title="Passwords"
        description={
          "Misty offers these on the sites they belong to and asks before saving new ones. " +
          "Each is encrypted with your vault key before it leaves this device."
        }
      >
        <div className="flex items-center gap-2 border-t border-charcoal-border py-3">
          <Input
            aria-label="Search passwords"
            placeholder="Search passwords"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="max-w-[320px]"
          />
          <div className="flex-1" />
          <Button variant="outline" onClick={() => setEditing("new")}>
            Add password
          </Button>
        </div>
        {editing ? (
          <LoginEditor
            login={editing === "new" ? null : editing}
            onDone={(saved) => {
              setEditing(null);
              if (saved) void load();
            }}
          />
        ) : null}
        {logins === null ? (
          <SkeletonList label="Passwords" rows={4} leading="icon" lines={2} trailing />
        ) : shown.length === 0 ? (
          <SettingsNote>
            {query.trim() ? "No saved passwords match." : "No saved passwords yet."}
          </SettingsNote>
        ) : (
          shown.map((login) => (
            <LoginRow
              key={login.id}
              login={login}
              onEdit={() => setEditing(login)}
              onRemoved={() => void load()}
              onError={setError}
            />
          ))
        )}
      </DesktopSettingsSection>
    </>
  );
}

function LoginRow(props: {
  login: SavedLogin;
  onEdit(): void;
  onRemoved(): void;
  onError(message: string): void;
}) {
  const { login } = props;
  const [password, setPassword] = useState<string | null>(null);
  const reveal = async () => {
    if (password !== null) {
      setPassword(null);
      return;
    }
    try {
      setPassword(await passwordsApi.reveal(login.id));
    } catch (reason) {
      props.onError(String(reason));
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(await passwordsApi.reveal(login.id));
    } catch (reason) {
      props.onError(String(reason));
    }
  };
  const remove = async () => {
    try {
      await passwordsApi.remove(login.id);
      props.onRemoved();
    } catch (reason) {
      props.onError(String(reason));
    }
  };
  return (
    <DesktopSettingsRow
      label={siteLabel(login.origin)}
      description={
        <>
          {login.username || "No username"}
          {password !== null ? (
            <span className="ml-2 font-mono text-cream" data-private="true">
              {password}
            </span>
          ) : null}
        </>
      }
    >
      <IconButton size="xs" label={password ? "Hide password" : "Show password"} onClick={reveal}>
        {password ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </IconButton>
      <IconButton size="xs" label="Copy password" onClick={copy}>
        <Copy className="size-3.5" />
      </IconButton>
      <IconButton size="xs" label="Edit" onClick={props.onEdit}>
        <Pencil className="size-3.5" />
      </IconButton>
      <IconButton size="xs" label="Delete" onClick={remove}>
        <Trash2 className="size-3.5" />
      </IconButton>
    </DesktopSettingsRow>
  );
}

function LoginEditor(props: { login: SavedLogin | null; onDone(saved: boolean): void }) {
  const [site, setSite] = useState(props.login?.origin ?? "");
  const [username, setUsername] = useState(props.login?.username ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await passwordsApi.save({ id: props.login?.id, site, username, password });
      props.onDone(true);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="ph-no-capture grid gap-2 border-t border-charcoal-border py-3"
      data-private="true"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Input
        aria-label="Site"
        placeholder="Site, such as example.com"
        value={site}
        disabled={busy || Boolean(props.login)}
        onChange={(event) => setSite(event.target.value)}
      />
      <Input
        aria-label="Username"
        placeholder="Username or email"
        autoComplete="off"
        value={username}
        disabled={busy}
        onChange={(event) => setUsername(event.target.value)}
      />
      <Input
        aria-label="Password"
        type="password"
        autoComplete="new-password"
        placeholder={props.login ? "Leave empty to keep the current password" : "Password"}
        value={password}
        disabled={busy}
        onChange={(event) => setPassword(event.target.value)}
      />
      {error ? (
        <p role="alert" className="text-sm text-cream">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={busy} onClick={() => props.onDone(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !site.trim()}>
          {props.login ? "Save changes" : "Add password"}
        </Button>
      </div>
    </form>
  );
}
