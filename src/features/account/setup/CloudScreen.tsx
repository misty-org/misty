import { accountApi } from "../api/api";
import { probeServer } from "@/api/deployment/probe";
import { currentApiBase } from "@/api/deployment/serverChoice";
import { useAuth } from "../sessions/authState";
import AuthField from "../components/AuthField";
import AuthMessage from "../components/AuthMessage";
import { authButtonClass } from "../components/authButtonClass";
import { accountFinishSetupKey, accountRedeemSetupKey } from "../sessions/useAccountStore";
import { Button, Spinner } from "@/shared/ui";
import { useEffect, useState, type FormEvent } from "react";
import { isSetupKey, parseServerAddress, parseSetupLink } from "./serverAddress";
import { takeSetupLink, useSetupLinkStore } from "./setupLinkStore";
import { useServerSwitch } from "./useServerSwitch";

/**
 * Any server's sign-in link: the link holds the server and a one-time setup key.
 * The server address and the key typed apart work too, and a `misty://setup` link fills both
 * in. The key signs in once; the person then chooses a password (`ChoosePasswordScreen`).
 */
export function CloudScreen(props: {
  onRedeemed: (hasPassword: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const { authenticateAccount, transitioning } = useAuth();
  const { moveTo } = useServerSwitch();
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
      if (!(await probeServer(target.apiBase))) {
        setError("Misty couldn't reach that server. Check the link and your connection.");
        return;
      }
      // Moving signs out of the current server, so the new one takes the key first: a key it
      // refuses leaves this device signed in where it was.
      const redeemed =
        currentApiBase() === target.apiBase
          ? null
          : await accountApi.redeemSetupKeyOn(target.apiBase, target.setupKey);
      await moveTo(target.apiBase);
      let provider: string | undefined;
      await authenticateAccount(async () => {
        const user = await (redeemed
          ? accountFinishSetupKey(redeemed)
          : accountRedeemSetupKey(target.setupKey));
        provider = user.provider;
        return user;
      });
      props.onRedeemed(provider !== "google");
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
        label="Sign-in link"
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
      {error ? <AuthMessage tone="error" message={error} /> : null}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        className={authButtonClass}
        disabled={disabled || !ready}
        aria-busy={busy}
      >
        {busy ? <Spinner size="sm" label={false} /> : null}
        Continue
      </Button>
    </form>
  );
}
