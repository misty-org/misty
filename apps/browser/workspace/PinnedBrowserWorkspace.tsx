import { useCallback, useEffect, useRef, useState } from "react";
import type { MistyComponentContext } from "@misty/sdk";
import { SDKBrowserView, type BrowserViewServices } from "./SDKBrowserView";
import { PagePinButton } from "../../shared/PagePinButton";
import { WebsiteLoader } from "../../shared/WebsiteLoader";
import {
  browserPinNavigation,
  browserPinsChanged,
  browserPinUrl,
  loadBrowserPins,
  toggleBrowserPin,
  type BrowserPin,
} from "./browserPins";

export function BrowserWorkspace({
  services,
  context,
}: {
  services: BrowserViewServices;
  context: MistyComponentContext;
}) {
  const { misty, report } = services;
  const [pins, setPins] = useState<BrowserPin[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const writing = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const run = ++generation.current;
    const next = await loadBrowserPins(misty.storage.local);
    if (run !== generation.current) return;
    setPins(next);
    setLoaded(true);
    setError("");
    setReady(true);
    await misty.navigation.setItems(browserPinNavigation(next));
  }, [misty]);
  useEffect(() => {
    let closed = false;
    const changed = () => {
      void refresh().catch((error) => {
        if (!closed) {
          setReady(true);
          setError(String(error));
          report(error);
        }
      });
    };
    changed();
    window.addEventListener(browserPinsChanged, changed);
    return () => {
      closed = true;
      generation.current++;
      window.removeEventListener(browserPinsChanged, changed);
    };
  }, [refresh, report]);
  const toggle = async (url: string, title: string) => {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    try {
      await toggleBrowserPin(misty.storage.local, url, title);
      await refresh();
    } catch (error) {
      setError(String(error));
      report(error);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };
  const pinId = new URL(context.route, "https://misty.local").searchParams.get(
    "pin",
  );
  const destination = pins.find((pin) => pin.id === pinId)?.url;
  if (!ready) return <WebsiteLoader />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 border-b border-charcoal-border px-3 py-2 text-xs text-cream-muted"
        >
          <span className="min-w-0 flex-1">Couldn’t update pins. {error}</span>
          <button
            className="rounded px-2 py-1 hover:bg-charcoal-hover"
            onClick={() =>
              void refresh().catch((error) => {
                setError(String(error));
                report(error);
              })
            }
          >
            Retry
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <SDKBrowserView
          services={services}
          context={context}
          initialUrl={destination}
          renderPin={({ url, title }) => (
            <PagePinButton
              pinned={pins.some(
                (pin) => browserPinUrl(pin.url) === browserPinUrl(url),
              )}
              disabled={!loaded || !browserPinUrl(url)}
              busy={busy}
              onClick={() => void toggle(url, title)}
            />
          )}
        />
      </div>
    </div>
  );
}
