import { confirmAction } from "@/shared/lib/confirmAction";
import { Button, Input } from "@/shared/ui";
import { useEffect, useState } from "react";
import { effectiveValues } from "./model";
import { useSettingsProfiles } from "./store";
const selectClass =
  "min-h-9 w-full rounded-md border border-charcoal-border bg-charcoal-bg px-2 text-sm text-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-cream-muted";
export function ProfileSelector() {
  const store = useSettingsProfiles();
  return (
    <label className="grid gap-1.5 text-xs text-cream-muted">
      <span className="flex items-center justify-between gap-2">
        Settings profile <span className="text-[10px]">This device</span>
      </span>
      <select
        aria-label="Settings profile"
        className={selectClass}
        value={store.state?.selectedProfileId ?? ""}
        disabled={!store.ready}
        onChange={(e) => void store.select(e.target.value || null).catch(() => {})}
      >
        <option value="">Local only</option>
        {Object.values(store.state?.profiles ?? {}).map((p) => (
          <option value={p.id} key={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
export function ProfilesSection() {
  const store = useSettingsProfiles();
  const [name, setName] = useState("");
  const [source, setSource] = useState("current");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const execute = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      <p className="text-sm text-cream-muted">
        Choose the preferences this device follows. Tabs, website logins, connections and
        permissions stay where they are.
      </p>
      <p className="text-xs text-cream-muted">
        Profiles are private to your account on this server. Selection and overrides stay on this
        device.
      </p>
      <ProfileSelector />
      {!store.accountId && (
        <p className="text-sm text-cream-muted">
          Sign in to create and sync profiles. Local preferences remain available.
        </p>
      )}
      <form
        className="grid gap-3 border-t border-charcoal-border pt-5"
        onSubmit={(e) => {
          e.preventDefault();
          void execute(async () => {
            await store.createProfile(name, source);
            setName("");
          });
        }}
      >
        <h2 className="text-sm font-semibold">Create profile</h2>
        <Input
          aria-label="Profile name"
          placeholder="Work, Personal…"
          maxLength={80}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label className="grid gap-1 text-xs text-cream-muted">
          Start with
          <select
            className={selectClass}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="current">Current preferences</option>
            <option value="defaults">Built-in defaults</option>
            {Object.values(store.state?.profiles ?? {}).map((p) => (
              <option key={p.id} value={p.id}>
                Copy of {p.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="submit"
          variant="outline"
          disabled={busy || !store.accountId || !store.ready || !name.trim()}
        >
          Create profile
        </Button>
      </form>
      <div className="divide-y divide-charcoal-border">
        {Object.values(store.state?.profiles ?? {}).map((p) => (
          <ProfileRow
            key={p.id}
            id={p.id}
            name={p.name}
            selected={store.state?.selectedProfileId === p.id}
            disabled={busy}
            execute={execute}
          />
        ))}
      </div>
      {store.state?.notice && (
        <p role="status" className="text-sm text-cream-muted">
          {store.state.notice}
        </p>
      )}
      {(error || store.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error || store.error}
        </p>
      )}
    </div>
  );
}
function ProfileRow(props: {
  id: string;
  name: string;
  selected: boolean;
  disabled: boolean;
  execute(action: () => Promise<void>): Promise<void>;
}) {
  const store = useSettingsProfiles();
  const [name, setName] = useState(props.name);
  useEffect(() => setName(props.name), [props.name]);
  return (
    <form
      className="flex flex-wrap items-center gap-2 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        void props.execute(() => store.rename(props.id, name));
      }}
    >
      <Input
        aria-label={`Rename ${props.name}`}
        maxLength={80}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="min-w-36 flex-1"
      />
      <Button
        size="sm"
        variant="ghost"
        disabled={props.disabled || !name.trim() || name === props.name}
        type="submit"
      >
        Rename
      </Button>
      <Button
        size="sm"
        variant="outline"
        type="button"
        disabled={props.disabled || props.selected}
        onClick={() => void props.execute(() => store.select(props.id))}
      >
        {props.selected ? "Selected" : "Use"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        type="button"
        disabled={props.disabled}
        onClick={() =>
          void props.execute(() => store.createProfile(`${props.name.slice(0, 70)} copy`, props.id))
        }
      >
        Duplicate
      </Button>
      <Button
        size="sm"
        variant="ghost"
        type="button"
        disabled={props.disabled}
        onClick={() =>
          void props.execute(async () => {
            if (
              await confirmAction(
                `Delete “${props.name}”? Devices using it keep their preferences locally.`,
                "Delete profile",
              )
            )
              await store.remove(props.id);
          })
        }
      >
        Delete
      </Button>
    </form>
  );
}
export function SyncSection() {
  const store = useSettingsProfiles();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const pending = store.state?.outbox.length ?? 0;
  const label = store.error
    ? "Needs attention"
    : pending
      ? "Saved locally · waiting to sync"
      : store.syncing
        ? "Syncing"
        : store.state?.selectedProfileId
          ? online
            ? "Up to date"
            : "Saved locally · waiting to sync"
          : "Local only";
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold">Settings synchronization</h2>
      <p role="status" className="text-sm">
        {label}
      </p>
      <p className="text-sm text-cream-muted">
        {pending} changes waiting. Preferences sync through your account. When devices change the
        same setting, the last change committed by the server wins.
      </p>
      <p className="text-sm text-cream-muted">Browser sessions use Device Handoff under Browser.</p>
      {Object.keys(store.state?.overrides ?? {})
        .filter((key) => key.startsWith("deleted:"))
        .map((key) => (
          <div key={key} className="space-y-2 text-sm text-cream-muted">
            <p>Unsent edits from a deleted profile were preserved locally.</p>
            <Button variant="outline" onClick={() => void store.recover(key).catch(() => {})}>
              Recover as Local only
            </Button>
          </div>
        ))}
      <Button
        variant="outline"
        disabled={!store.ready || store.syncing}
        onClick={() => void store.refresh().catch(() => {})}
      >
        Retry sync
      </Button>
      {store.error && (
        <p role="alert" className="text-sm text-destructive">
          {store.error}
        </p>
      )}
      <p className="text-xs text-cream-muted">
        {store.state ? Object.keys(effectiveValues(store.state)).length : 0} portable preferences on
        this device.
      </p>
    </section>
  );
}
