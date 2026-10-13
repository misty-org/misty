import { Copy, Eye, EyeOff, KeyRound, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { passwordsApi, siteLabel, type SavedLogin } from "@/features/passwords/api";
import { useAuth } from "@/features/auth";
import { SyncUnlockForm } from "@/features/browser-workspace/SyncAccountSettings";
import { useSyncController } from "@/features/browser-workspace/useSyncController";
import { Button, CollectionSkeleton, IconButton, ListRow } from "@/shared/ui";
import { InternalPageEmpty, InternalPageFrame } from "./InternalPageFrame";
import { PasswordEditor } from "./PasswordEditor";

/** Saved sign-ins, sealed in the sync vault. Passwords are read only on request. */
export function PasswordsPage() {
  const { user } = useAuth();
  const sync = useSyncController(user?.id ?? "");
  const unlocked = Boolean(sync.session);
  const [logins, setLogins] = useState<SavedLogin[] | null>(null);
  const [text, setText] = useState("");
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
    const needle = text.trim().toLocaleLowerCase();
    return (logins ?? []).filter(
      (login) =>
        !needle || `${login.origin} ${login.username}`.toLocaleLowerCase().includes(needle),
    );
  }, [logins, text]);

  if (!unlocked)
    return (
      <InternalPageFrame title="Passwords">
        {sync.accountId ? (
          <div className="mx-auto w-full max-w-xl">
            <p className="mb-4 text-sm text-cream-muted">
              Saved passwords are encrypted with your sync vault. Unlock it to see and fill them.
            </p>
            <SyncUnlockForm controller={sync} sectionTitle="Unlock your sync vault" />
          </div>
        ) : (
          <InternalPageEmpty
            title="Sign in to Misty"
            detail="Saved passwords are encrypted with your sync vault, which belongs to your account."
          />
        )}
      </InternalPageFrame>
    );

  return (
    <InternalPageFrame
      title="Passwords"
      search={{ value: text, placeholder: "Search passwords", onChange: setText }}
      actions={
        <Button variant="outline" onClick={() => setEditing("new")}>
          Add password
        </Button>
      }
    >
      {error ? (
        <p role="alert" className="mb-3 text-sm text-cream-muted">
          {error}
        </p>
      ) : null}
      {editing ? (
        <PasswordEditor
          login={editing === "new" ? null : editing}
          onDone={(saved) => {
            setEditing(null);
            if (saved) void load();
          }}
        />
      ) : null}
      {logins === null && !error ? (
        <CollectionSkeleton label="Passwords" view="rows" />
      ) : null}
      {logins !== null && !visible.length ? (
        <InternalPageEmpty
          title={text ? "No matching passwords" : "No saved passwords yet"}
          detail={
            text
              ? undefined
              : "Misty asks before saving a sign-in and offers it again on the site it belongs to."
          }
        />
      ) : null}
      <ul className="grid gap-1">
        {visible.map((login) => (
          <PasswordRow
            key={login.id}
            login={login}
            onEdit={() => setEditing(login)}
            onRemoved={() => void load()}
            onError={setError}
          />
        ))}
      </ul>
    </InternalPageFrame>
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
  const reveal = () =>
    attempt(async () => {
      setPassword(password !== null ? null : await passwordsApi.reveal(login.id));
    });
  const copy = () =>
    attempt(async () => navigator.clipboard.writeText(await passwordsApi.reveal(login.id)));
  const remove = () =>
    attempt(async () => {
      await passwordsApi.remove(login.id);
      props.onRemoved();
    });
  return (
    <ListRow className="flex-wrap items-center py-2.5">
      <KeyRound className="size-5 shrink-0 text-cream-muted" aria-hidden="true" />
      <div className="min-w-0 flex-1 basis-40">
        <p className="truncate text-sm text-cream-bright" title={login.origin}>
          {siteLabel(login.origin)}
        </p>
        <p className="mt-0.5 truncate text-xs text-cream-muted">
          {login.username || "No username"}
          {password !== null ? (
            <span className="ml-2 font-mono text-cream" data-private="true">
              {password}
            </span>
          ) : null}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-1">
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
      </div>
    </ListRow>
  );
}
