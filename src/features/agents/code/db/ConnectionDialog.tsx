import { useState, type ChangeEvent } from "react";
import {
  Button,
  ChoiceGroup,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  Input,
  OptionSelect,
  SecretField,
  notify,
} from "@misty/ui";
import {
  dbApi,
  errorText,
  type DbConnection,
  type DbKind,
  type SavedConnection,
  type SslMode,
} from "./dbApi";
import { useDbStore } from "./dbStore";

interface Draft {
  name: string;
  kind: DbKind;
  path: string;
  host: string;
  port: string;
  database: string;
  user: string;
  sslMode: SslMode;
  /** A password typed for a connection that has no saved one to replace yet. */
  password: string;
}

type FieldName = "name" | "path" | "host" | "port" | "database" | "user";

function draftOf(saved: SavedConnection | null): Draft {
  return {
    name: saved?.name ?? "",
    kind: saved?.kind ?? "sqlite",
    path: saved?.sqlite?.path ?? "",
    host: saved?.postgres?.host ?? "localhost",
    port: String(saved?.postgres?.port ?? 5432),
    database: saved?.postgres?.database ?? "",
    user: saved?.postgres?.user ?? "",
    sslMode: saved?.postgres?.sslMode ?? "prefer",
    password: "",
  };
}

/** What's missing, field by field, before anything is sent. */
function problems(draft: Draft): Partial<Record<FieldName, string>> {
  const found: Partial<Record<FieldName, string>> = {};
  if (!draft.name.trim()) found.name = "Give the connection a name.";
  if (draft.kind === "sqlite") {
    if (!draft.path.trim()) found.path = "Choose a database file.";
    return found;
  }
  const port = Number(draft.port);
  if (!draft.host.trim()) found.host = "Enter the server's host.";
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    found.port = "Enter a port from 1 to 65535.";
  if (!draft.database.trim()) found.database = "Enter the database's name.";
  if (!draft.user.trim()) found.user = "Enter the user to connect as.";
  return found;
}

function connectionOf(id: string, draft: Draft): DbConnection {
  return draft.kind === "sqlite"
    ? { id, name: draft.name.trim(), kind: "sqlite", sqlite: { path: draft.path.trim() } }
    : {
        id,
        name: draft.name.trim(),
        kind: "postgres",
        postgres: {
          host: draft.host.trim(),
          port: Number(draft.port),
          database: draft.database.trim(),
          user: draft.user.trim(),
          sslMode: draft.sslMode,
        },
      };
}

const fileName = (path: string) =>
  path
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^.]+$/, "") ?? "";

const kindOptions = [
  { value: "sqlite", label: "SQLite" },
  { value: "postgres", label: "Postgres" },
] as const;

const sslOptions = [
  { value: "disable", label: "Off" },
  { value: "prefer", label: "When the server offers it" },
  { value: "require", label: "Required" },
];

/** The file field and its Choose file button, wired by Field like a single control. */
function PathInput(props: {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  value: string;
  disabled: boolean;
  onChange(value: string): void;
  onPick(): void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Input
        id={props.id}
        aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"]}
        className="min-w-0 flex-1"
        value={props.value}
        placeholder="A file in a linked folder"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(event) => props.onChange(event.target.value)}
      />
      <Button disabled={props.disabled} onClick={props.onPick}>
        Choose file
      </Button>
    </div>
  );
}

/**
 * Adds a connection, or edits a saved one. A saved Postgres password shows as saved, with Replace
 * and Remove in its menu, and changes right away; a new connection's password is saved with it.
 */
export function ConnectionDialog(props: { connection: SavedConnection | null; onClose(): void }) {
  // The store's copy, so a password saved or removed here shows at once.
  const saved =
    useDbStore((state) => state.connections?.find((item) => item.id === props.connection?.id)) ??
    props.connection;
  const saveConnection = useDbStore((state) => state.saveConnection);
  const [draft, setDraft] = useState(() => draftOf(saved));
  const [shown, setShown] = useState<Partial<Record<FieldName, string>>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The saved password belongs to the saved Postgres connection; anything else types a new one.
  const savedSecret = saved?.kind === "postgres" && draft.kind === "postgres" ? saved : null;

  const change = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setShown((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key as FieldName];
      return next;
    });
    setError("");
  };
  const text = (name: FieldName | "password") => (event: ChangeEvent<HTMLInputElement>) =>
    change({ [name]: event.target.value } as Partial<Draft>);

  const checked = () => {
    const found = problems(draft);
    setShown(found);
    return Object.keys(found).length === 0;
  };
  const typedPassword = () =>
    draft.kind === "postgres" && !savedSecret && draft.password ? draft.password : undefined;

  const pick = async () => {
    setError("");
    try {
      const path = await dbApi.pickSqlite();
      if (path) change({ path, ...(draft.name.trim() ? {} : { name: fileName(path) }) });
    } catch (failure) {
      setError(errorText(failure));
    }
  };

  const test = async () => {
    if (!checked()) return;
    setBusy(true);
    setError("");
    try {
      await dbApi.test(connectionOf(saved?.id ?? "", draft), typedPassword());
      notify({ message: `Connected to ${draft.name.trim()}.` });
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!checked()) return;
    setBusy(true);
    setError("");
    try {
      await saveConnection(connectionOf(saved?.id ?? "", draft), typedPassword());
      props.onClose();
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{saved ? "Edit connection" : "Add connection"}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <ChoiceGroup
            label="Kind"
            value={draft.kind}
            options={kindOptions}
            fill
            onChange={(kind) => change({ kind })}
          />
          <Field label="Name" error={shown.name}>
            <Input value={draft.name} autoFocus onChange={text("name")} />
          </Field>
          {draft.kind === "sqlite" ? (
            <Field label="File" error={shown.path}>
              <PathInput
                value={draft.path}
                disabled={busy}
                onChange={(path) => change({ path })}
                onPick={() => void pick()}
              />
            </Field>
          ) : (
            <>
              <div className="flex min-w-0 items-start gap-3">
                <Field label="Host" error={shown.host} className="min-w-0 flex-1">
                  <Input
                    value={draft.host}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    onChange={text("host")}
                  />
                </Field>
                <Field label="Port" error={shown.port} className="w-24 flex-none">
                  <Input value={draft.port} inputMode="numeric" onChange={text("port")} />
                </Field>
              </div>
              <Field label="Database" error={shown.database}>
                <Input
                  value={draft.database}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  onChange={text("database")}
                />
              </Field>
              <Field label="User" error={shown.user}>
                <Input
                  value={draft.user}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  onChange={text("user")}
                />
              </Field>
              <Field label="Password">
                {savedSecret ? (
                  <SecretField
                    label="Password"
                    saved={savedSecret.hasPassword}
                    placeholder="Type the password"
                    removeWhat="It's deleted from this computer's keychain. Misty connects without one until you add it again."
                    // Only the password changes here; the rest saves with the dialog.
                    onSave={async (password) => {
                      await saveConnection(savedSecret, password);
                    }}
                    onRemove={async () => {
                      await saveConnection(savedSecret, "");
                    }}
                  />
                ) : (
                  <Input
                    type="password"
                    value={draft.password}
                    autoComplete="off"
                    placeholder="None"
                    onChange={text("password")}
                  />
                )}
              </Field>
              <Field label="Encryption">
                <OptionSelect
                  value={draft.sslMode}
                  options={sslOptions}
                  onValueChange={(sslMode) => change({ sslMode: sslMode as SslMode })}
                />
              </Field>
            </>
          )}
          <FieldError message={error} />
          <DialogFooter>
            <Button variant="quiet" size="lg" onClick={props.onClose}>
              Cancel
            </Button>
            <Button size="lg" disabled={busy} onClick={() => void test()}>
              Test
            </Button>
            <Button type="submit" variant="primary" size="lg" disabled={busy}>
              {saved ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
