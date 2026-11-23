import { accountApi } from "../api/api";
import { probeServer } from "@/api/deployment/probe";
import { currentApiBase } from "@/api/deployment/server_choice";
import { useAuth } from "../sessions/auth_state";
import AuthField from "../components/AuthField";
import AuthMessage from "../components/AuthMessage";
import { accountFinishSetupKey, accountRedeemSetupKey } from "../sessions/use_account_store";
import { Button } from "@misty/ui";
import { useEffect, useState, type FormEvent } from "react";
import { isSetupKey, parseServerAddress, parseSetupLink } from "./server_address";
import { takeSetupLink, useSetupLinkStore } from "./setup_link_store";
import { useServerSwitch } from "./use_server_switch";

export function CloudScreen(props: {
  onRedeemed: (hasPassword: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const { authenticateAccount, transitioning } = useAuth();
  const { moveTo } = useServerSwitch();
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
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
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
      <Button type="submit" variant="primary" size="lg" disabled={disabled || !ready || busy}>
        Continue
      </Button>
    </form>
  );
}
