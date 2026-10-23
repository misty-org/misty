import { Copy, Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/features/auth";
import { useSyncController } from "@/features/browser-sync/useSyncController";
import { PasswordEditor } from "@/features/passwords/PasswordEditor";
import { passwordsApi, siteLabel, type SavedLogin } from "@/features/passwords/api";
import { loginsToCsv, parseLoginsCsv, type CsvLogin } from "@/features/passwords/csv";
import { confirmAction } from "@/shared/lib/confirmAction";
import { Button, IconButton, Input, SkeletonList } from "@/shared/ui";
import {
  DesktopSettingsNotice,
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
} from "../components/DesktopSettingsUI";
import { SettingsNote } from "../SettingsControls";

/** Saved sign-ins, sealed in the sync vault, or in this device's local vault while nobody is
 * signed in. A password is read only when you ask for it. */
export function PasswordsSettings() {
  const { user } = useAuth();
  const sync = useSyncController(user?.id ?? "");
  const unlocked = !user || Boolean(sync.session);
  const [logins, setLogins] = useState<SavedLogin[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedLogin | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setLogins(await passwordsApi.list());
      setError(null);
    } catch {
      setError("Saved logins could not be loaded. Try again.");
    }
  }, []);
  useEffect(() => {
    if (unlocked) void load();
  }, [unlocked, load]);

  const importLogins = async (file: File) => {
    setNotice(null);
    const parsed = parseLoginsCsv(await file.text());
    if (!parsed.length) {
      setNotice("That file has no passwords Misty can read. It needs url and password columns.");
      return;
    }
    let added = 0;
    for (const login of parsed) {
      try {
        await passwordsApi.save(login);
        added += 1;
      } catch {
        // Counted below as skipped.
      }
    }
    setNotice(
      added === parsed.length
        ? `Imported ${added} password${added === 1 ? "" : "s"}.`
        : `Imported ${added} of ${parsed.length} passwords. The rest could not be saved.`,
    );
    void load();
  };

  const exportLogins = async () => {
    setNotice(null);
    const confirmed = await confirmAction(
      "The file will contain every saved password in plain text. Keep it somewhere safe and delete it when you are done. Export?",
    );
    if (!confirmed || !logins) return;
    try {
      const rows: CsvLogin[] = [];
      for (const login of logins) {
        rows.push({
          site: login.origin,
          username: login.username,
          password: await passwordsApi.reveal(login.id),
        });
      }
      const url = URL.createObjectURL(
        new Blob([loginsToCsv(rows)], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "misty-passwords.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setNotice("Passwords could not be exported. Try again.");
    }
  };

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
        title="Logins"
        description="Passwords are encrypted with your sync vault, which belongs to your account."
      >
        <SettingsRow
          label="Unlock your sync vault"
          description="Open the Sync wizard to connect this device before managing saved passwords."
        >
          <Button
            variant="outline"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("misty:open-settings", { detail: { section: "sync" } }),
              )
            }
          >
            Open Sync
          </Button>
        </SettingsRow>
      </SettingsSectionBlock>
    );

  return (
    <SettingsSectionBlock
      title="Logins"
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
        <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
          Import CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!logins?.length}
          onClick={() => void exportLogins()}
        >
          Export CSV
        </Button>
        <Input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          aria-label="Import passwords from a CSV file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importLogins(file);
          }}
        />
      </div>
      {notice ? <SettingsNote>{notice}</SettingsNote> : null}
      {editing ? (
        <PasswordEditor
          login={editing === "new" ? null : editing}
          onDone={(saved) => {
            setEditing(null);
            if (saved) void load();
          }}
        />
      ) : null}
      {error ? (
        <DesktopSettingsNotice
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        >
          {error}
        </DesktopSettingsNotice>
      ) : null}
      {logins === null && !error ? (
        <SkeletonList label="Logins" rows={4} leading="none" trailing />
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
    } catch {
      props.onError("That password action could not be completed. Try again.");
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
