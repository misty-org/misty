import { useState } from "react";
import { passwordsApi, type SavedLogin } from "@/features/passwords/api";
import { Button, Input } from "@/shared/ui";

/** Adds a sign-in, or changes the username and password of a saved one. */
export function PasswordEditor(props: { login: SavedLogin | null; onDone(saved: boolean): void }) {
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
      className="ph-no-capture mb-3 grid gap-2 py-2"
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
        <p role="alert" className="text-sm text-cream-muted">
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
