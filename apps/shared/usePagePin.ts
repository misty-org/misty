import { providerPageTitle } from "./navigationTitles";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MistyAppSDK, mistyBrowserProviders } from "@misty/sdk";
import { providerAccountsChanged } from "./accountStore";
import {
  loadProviderPins,
  saveProviderPin,
  deleteProviderPin,
} from "./providerPins";
import {
  loadWebsiteState,
  saveWebsitePin,
  deleteWebsitePin,
} from "./websiteStore";
import {
  savedWebsiteUrl,
  type WebsiteIntegrationId,
  type WebsiteAppId,
} from "./websiteIntegrations";
import type { ProviderId } from "./providers";
import { pagePinId, pagePinKey, pagePinLabel } from "./pagePins";

type PagePin = {
  id: string;
  provider: keyof typeof mistyBrowserProviders;
  accountId: string;
  url: string;
  label: string;
  order: number;
};

/** A single-click pin toggle shared by every embedded website family. */
export function usePagePin(props: {
  misty: MistyAppSDK;
  appId: "chat" | "inbox" | WebsiteAppId;
  provider: PagePin["provider"];
  accountId?: string;
  url: string;
  title: string;
  label: string;
  report(error: unknown): void;
}) {
  const { misty, appId, provider, accountId, report } = props;
  const storage = misty.storage.local;
  const scope = JSON.stringify([appId, provider, accountId]);
  const [state, setState] = useState<{
    scope: string;
    pins: PagePin[];
    ready: boolean;
  }>({ scope, pins: [], ready: false });
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const current = useRef(scope);
  current.current = scope;
  const generation = useRef(0);
  const load = useCallback(async (): Promise<PagePin[]> => {
    if (appId === "chat" || appId === "inbox") return loadProviderPins(storage);
    return (await loadWebsiteState(storage, appId)).pins;
  }, [storage, appId]);
  const refresh = useCallback(async () => {
    const run = ++generation.current;
    const pins = await load();
    if (current.current === scope && generation.current === run)
      setState({ scope, pins, ready: true });
  }, [load, scope]);
  useEffect(() => {
    const changed = () => {
      void refresh().catch(report);
    };
    changed();
    window.addEventListener(providerAccountsChanged, changed);
    return () => {
      generation.current++;
      window.removeEventListener(providerAccountsChanged, changed);
    };
  }, [refresh, report]);
  const url = savedWebsiteUrl(provider, props.url);
  const destination = { provider, accountId: accountId ?? "", url: url ?? "" };
  const key = pagePinKey(destination);
  const ready = state.scope === scope && state.ready;
  const pinned = ready && state.pins.some((pin) => pagePinKey(pin) === key);
  const toggle = async () => {
    if (!url || !accountId || !ready || writing.current) return;
    writing.current = true;
    setBusy(true);
    try {
      // Read again so another pane's latest save is respected. Removing a
      // destination also removes all old duplicates of that destination.
      const matches = (await load()).filter((pin) => pagePinKey(pin) === key);
      if (matches.length) {
        for (const pin of matches) {
          if (appId === "chat" || appId === "inbox")
            await deleteProviderPin(storage, pin.id);
          else await deleteWebsitePin(storage, pin.id);
        }
      } else {
        const pin = {
          ...destination,
          id: await pagePinId(destination),
          label: pagePinLabel(
            providerPageTitle(props.title, props.label),
            props.label,
          ),
          order: Date.now(),
        };
        if (appId === "chat" || appId === "inbox")
          await saveProviderPin(storage, {
            ...pin,
            provider: provider as ProviderId,
          });
        else
          await saveWebsitePin(storage, {
            ...pin,
            provider: provider as WebsiteIntegrationId,
          });
      }
      await refresh();
    } catch (error) {
      if (current.current === scope) report(error);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };
  return { pinned, busy, ready, toggle };
}
