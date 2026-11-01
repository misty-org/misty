import { useAuth } from "../authState";
import AuthField from "../components/AuthField";
import AuthMessage from "../components/AuthMessage";
import { accountRedeemSetupKey } from "../store/useAccountStore";
import { Button, Spinner } from "@/shared/ui";
import { useEffect, useState, type FormEvent } from "react";
import { isSetupKey, parseServerAddress, parseSetupLink } from "./serverAddress";
import { takeSetupLink, useSetupLinkStore } from "./setupLinkStore";
import { useServerSwitch } from "./useServerSwitch";

/**
 * Misty Cloud, or any server's sign-in link: the link holds the server and a one-time setup key.
 * The server address and the key typed apart work too, and a `misty://setup` link fills both
 * in. The key signs in once; the person then chooses a password (`ChoosePasswordScreen`).
 */
export function CloudScreen(props: { onRedeemed: () => void; onBusy: (busy: boolean) => void }) {
  const { authenticateAccount, transitioning } = useAuth();
  const { switchTo } = useServerSwitch();
  // A misty://setup link fills the fields once; it is let go after the first render.
  const [opened] = useState(() => useSetupLinkStore.getState().link);
  useEffect(() => void takeSetupLink(), []);
  const [link, setLink] = useState(opened?.origin ?? "");
  const [key, setKey] = useState(opened?.setupKey ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = parseSetupLink(link);
  const address = parsed ? null : parseServerAddress(link);
  const typedApart = Boolean(link.trim()) && !parsed && address && !("error" in address);
  const ready = Boolean(parsed) || Boolean(typedApart && isSetupKey(key));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target =
      parsed ?? (address && !("error" in address) ? { ...address, setupKey: key.trim() } : null);
    if (!target) return;
    setError("");
    setBusy(true);
    props.onBusy(true);
    try {
      if (!(await switchTo(target.apiBase))) {
        setError("Misty couldn't reach that server. Check the link and your connection.");
        return;
      }
      await authenticateAccount(() => accountRedeemSetupKey(target.setupKey));
      props.onRedeemed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That setup key didn't work.");
    } finally {
      setBusy(false);
      props.onBusy(false);
    }
  }

  const disabled = busy || transitioning;
  return (
    <form className="flex flex-col gap-3.5" onSubmit={(event) => void submit(event)}>
      <AuthField
        id="setup-link"
        label="Setup link"
        value={link}
        placeholder="https://mistysys.com/setup#server=…"
        autoComplete="off"
        disabled={disabled}
        onChange={setLink}
      />
      {typedApart ? (
        <AuthField
          id="setup-key"
          label="Setup key"
          value={key}
          placeholder="misty_setup_…"
          autoComplete="off"
          disabled={disabled}
          onChange={setKey}
        />
      ) : null}
      <p className="m-0 text-sm text-cream-muted">
        A sign-in link holds the server address and a key, which also work typed apart. A key works
        once and lasts seven days.
      </p>
      {error ? <AuthMessage tone="error" message={error} /> : null}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={disabled || !ready}
        aria-busy={busy}
      >
        {busy ? <Spinner size="sm" label={false} /> : null}
        Continue
      </Button>
    </form>
  );
}
