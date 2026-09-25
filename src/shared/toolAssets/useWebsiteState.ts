import { useCallback, useEffect, useState } from "react";
import type { MistyAppSDK } from "@misty/sdk";
import { providerAccountsChanged } from "./accountStore";
import { loadWebsiteState, type WebsiteState } from "./websiteStore";
import type { WebsiteAppId } from "./websiteIntegrations";
export function useWebsiteState(misty: MistyAppSDK, app: WebsiteAppId) {
  const [state, setState] = useState<WebsiteState>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let closed = false,
      generation = 0;
    const refresh = () => {
      const run = ++generation;
      void loadWebsiteState(misty.storage.local, app)
        .then((value) => {
          if (!closed && run === generation) {
            setState(value);
            setError("");
          }
        })
        .catch(() => {
          if (!closed)
            setError(
              "Your website integrations could not be loaded. Retry to reconnect.",
            );
        });
    };
    refresh();
    window.addEventListener(providerAccountsChanged, refresh);
    return () => {
      closed = true;
      window.removeEventListener(providerAccountsChanged, refresh);
    };
  }, [misty, app, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, error, retry };
}
