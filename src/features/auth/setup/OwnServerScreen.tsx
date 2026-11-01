import { developmentServer } from "@/api/deployment/serverChoice";
import AuthField from "../components/AuthField";
import AuthMessage from "../components/AuthMessage";
import { Button, Spinner } from "@/shared/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState, type FormEvent } from "react";
import { parseServerAddress } from "./serverAddress";
import { useServerSwitch } from "./useServerSwitch";

/** The website's guide to running a Misty server. A placeholder until the website ships it. */
export const selfHostingDocsUrl = "https://misty.example/docs/self-hosting";

/** A Misty server you run: its address first, then the usual sign-in on that server. */
export function OwnServerScreen(props: {
  onConnected: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const { switchTo } = useServerSwitch();
  const [address, setAddress] = useState(() => developmentServer().replace(/\/v1$/, ""));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseServerAddress(address);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setError("");
    setBusy(true);
    props.onBusy(true);
    try {
      if (await switchTo(parsed.apiBase)) props.onConnected();
      else setError("Misty couldn't reach a Misty server there. Check the address.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Misty couldn't switch servers.");
    } finally {
      setBusy(false);
      props.onBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3.5" onSubmit={(event) => void submit(event)}>
      <AuthField
        id="setup-server"
        label="Server address"
        value={address}
        placeholder="misty.example.com"
        autoComplete="url"
        disabled={busy}
        onChange={setAddress}
      />
      <p className="m-0 text-sm text-cream-muted">
        Running one yourself?{" "}
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 text-sm text-cream"
          onClick={() => void openUrl(selfHostingDocsUrl)}
        >
          Read how to set up a server
        </Button>
        .
      </p>
      {error ? <AuthMessage tone="error" message={error} /> : null}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={busy || !address.trim()}
        aria-busy={busy}
      >
        {busy ? <Spinner size="sm" label={false} /> : null}
        Continue
      </Button>
    </form>
  );
}
