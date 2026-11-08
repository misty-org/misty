import { useServerChoice } from "@/api/deployment/serverChoice";
import { BackButton } from "@/shared/ui";
import { Cloud, Server } from "lucide-react";
import { useState } from "react";
import AuthMessage from "../components/AuthMessage";
import { OwnServerScreen } from "./OwnServerScreen";
import { ServerOption } from "./ServerChoiceScreen";
import { useServerSwitch } from "./useServerSwitch";

const ignoreConnected = () => undefined;

/** Accounts live on a server and a device starts with none, so it may need one first. Only a
 * choice counts: a development build's default address fills in the form but doesn't choose. */
export function useNeedsServer(): boolean {
  return useServerChoice((state) => state.loaded && state.choice?.mode !== "server");
}

/** Asks for the server on the sign-in pages: Misty Pro or a self-hosted one. Choosing brings the
 * page's own form back. A sign-in link names its own server and opens in the sign-in sheet. */
export function ServerStep() {
  const { switchToMistyPro } = useServerSwitch();
  const [selfHosted, setSelfHosted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function chooseMistyPro() {
    setError("");
    setBusy(true);
    try {
      await switchToMistyPro();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Misty couldn't switch servers.");
    } finally {
      setBusy(false);
    }
  }

  if (selfHosted) {
    return (
      <div className="flex flex-col gap-3.5">
        <BackButton className="self-start" disabled={busy} onClick={() => setSelfHosted(false)} />
        <OwnServerScreen onBusy={setBusy} onConnected={ignoreConnected} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <ServerOption
        icon={<Cloud />}
        label="Misty Pro"
        busy={busy}
        disabled={busy}
        onSelect={() => void chooseMistyPro()}
      />
      <ServerOption
        icon={<Server />}
        label="Self-hosted"
        disabled={busy}
        onSelect={() => setSelfHosted(true)}
      />
      {error ? <AuthMessage tone="error" message={error} /> : null}
    </div>
  );
}
