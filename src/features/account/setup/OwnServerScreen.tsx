import AuthField from "../components/AuthField";
import AuthMessage from "../components/AuthMessage";
import { Button, InlineLink, Text } from "@misty/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState, type FormEvent } from "react";
import { parseServerAddress } from "./server_address";
import { useServerSwitch } from "./use_server_switch";

const selfHostingDocsUrl = "https://docs.mistysys.com/self-hosting";

export function OwnServerScreen(props: {
  onConnected: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const { switchTo } = useServerSwitch();
  const [address, setAddress] = useState("");
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
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      <AuthField
        id="setup-server"
        label="Server address"
        value={address}
        placeholder="https://misty.example.com"
        autoComplete="url"
        disabled={busy}
        onChange={setAddress}
      />
      <Text size="caption" tone="muted" wrap className="-mt-2">
        New to this?{" "}
        <InlineLink type="button" onClick={() => void openUrl(selfHostingDocsUrl)}>
          Set up a server
        </InlineLink>
      </Text>
      {error ? <AuthMessage tone="error" message={error} /> : null}
      <Button type="submit" variant="primary" size="lg" disabled={busy || !address.trim()}>
        Continue
      </Button>
    </form>
  );
}
