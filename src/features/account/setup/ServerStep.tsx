import { useServerChoice } from "@/api/deployment/serverChoice";
import { Button, ChoiceGroup } from "@misty/ui";
import { Cloud, Server } from "lucide-react";
import { useState } from "react";
import AuthMessage from "../components/AuthMessage";
import { OwnServerScreen } from "./OwnServerScreen";
import { useServerSwitch } from "./useServerSwitch";

const ignoreConnected = () => undefined;

type ServerKind = "cloud" | "custom";

const serverKinds = [
  { value: "cloud", label: "Misty Cloud", icon: Cloud },
  { value: "custom", label: "Custom Server", icon: Server },
] as const;

/** Accounts live on a server and a device starts with none, so it may need one first. Only a
 * choice counts: a development build's default address fills in the form but doesn't choose. */
export function useNeedsServer(): boolean {
  return useServerChoice((state) => state.loaded && state.choice?.mode !== "server");
}

/** Asks for the server on the sign-in pages, as a switch between Misty Cloud, which most people
 * want and is chosen at first, and a custom server's address. Either way Continue sits in the
 * same place, and choosing brings the page's own form back. A sign-in link names its own server
 * and opens in the sign-in sheet. */
export function ServerStep() {
  const { switchToMistyCloud } = useServerSwitch();
  const [kind, setKind] = useState<ServerKind>("cloud");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function chooseMistyCloud() {
    setError("");
    setBusy(true);
    try {
      await switchToMistyCloud();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Misty couldn't switch servers.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ChoiceGroup
        label="Server"
        value={kind}
        options={serverKinds}
        disabled={busy}
        fill
        onChange={(next) => {
          setError("");
          setKind(next);
        }}
      />
      {kind === "custom" ? (
        <OwnServerScreen onBusy={setBusy} onConnected={ignoreConnected} />
      ) : (
        <div className="flex flex-col gap-4">
          {error ? <AuthMessage tone="error" message={error} /> : null}
          <Button
            variant="primary"
            size="lg"
            disabled={busy}
            onClick={() => void chooseMistyCloud()}
          >
            Continue
          </Button>
        </div>
      )}
    </div>
  );
}
