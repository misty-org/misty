import { useEffect, useState } from "react";
import type { MistyAppSDK } from "@misty/sdk";
import { providerAccountsChanged } from "./accountStore";
import {
  loadProviderDirectory,
  providerAppPath,
  type ProviderDirectoryState,
} from "./providerDirectoryStore";
import { ProviderBrandIcon } from "./ProviderBrandIcon";
import { providers, type ProviderId } from "./providers";
import { PlatformDirectory } from "./PlatformDirectory";

export function ProviderDirectory({
  appId,
  misty,
  embedded = false,
}: {
  appId: "chat" | "inbox" | "music" | "media";
  misty: MistyAppSDK;
  embedded?: boolean;
}) {
  const [state, setState] = useState<ProviderDirectoryState>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string>();
  useEffect(() => {
    let closed = false,
      generation = 0;
    const refresh = () => {
      const run = ++generation;
      const apply = (value: ProviderDirectoryState) => {
        if (!closed && run === generation) {
          setState(value);
          setError("");
        }
      };
      void loadProviderDirectory(misty, appId, apply)
        .then(apply)
        .catch(() => {
          if (!closed) setError("Profiles could not be loaded. Try again.");
        });
    };
    refresh();
    window.addEventListener(providerAccountsChanged, refresh);
    return () => {
      closed = true;
      window.removeEventListener(providerAccountsChanged, refresh);
    };
  }, [misty, appId, attempt]);
  const title =
    appId === "chat"
      ? "Social"
      : appId === "music"
        ? "Music"
        : appId === "media"
          ? "Media"
          : "Inbox";
  useEffect(() => {
    if (!embedded) void misty.workspace.setTitle(title).catch(() => {});
  }, [misty, title, embedded]);
  const open = async (id: string) => {
    setBusy(id);
    try {
      await misty.navigation.open(`${providerAppPath(appId)}?provider=${id}`);
    } catch {
      setError("This website could not be opened. Try again.");
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <PlatformDirectory
      title={title}
      embedded={embedded}
      loading={!state}
      error={error || state?.mailError}
      onRetry={() => setAttempt((n) => n + 1)}
      busy={busy}
      entries={
        state
          ? (
              Object.entries(providers) as [
                ProviderId,
                (typeof providers)[ProviderId],
              ][]
            )
              .filter(([, item]) => item.family === appId)
              .map(([id, item]) => ({
                id,
                label: item.label,
                icon: <ProviderBrandIcon provider={id} />,
                added: state.added.has(id),
                description: state.added.has(id)
                  ? state.hidden.has(id)
                    ? "Hidden from sidebar"
                    : "In your sidebar"
                  : "",
                onSelect: () => void open(id),
                onOpen: () => void open(id),
              }))
          : []
      }
    >

    </PlatformDirectory>
  );
}
