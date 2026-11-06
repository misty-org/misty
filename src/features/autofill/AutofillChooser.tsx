import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { CreditCard, MapPin, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { openSettings } from "@/features/settings/openSettings";
import {
  browserOverlayReady,
  browserRuntimeIdForTabId,
  setBrowserWebviewsSuspended,
} from "@/features/webviews/browserRuntime";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ErrorNotification,
  MenuItem,
  Portal,
} from "@/shared/ui";
import { autofillApi, type AutofillChoice } from "./api";

const suspensionReason = "browser-autofill";
/** What the chooser passes back when the person opens Settings instead of picking. */
const MANAGE = "manage";

/** A point on a page, as a point in the window. Falls back to the window's middle. */
function pointOnPage(choice: AutofillChoice): { left: number; top: number } {
  for (const host of document.querySelectorAll<HTMLElement>("[data-browser-page-host]")) {
    const tabId = host
      .closest("[data-browser-workspace-tab]")
      ?.getAttribute("data-browser-workspace-tab");
    if (!tabId || browserRuntimeIdForTabId(tabId) !== choice.id) continue;
    const rect = host.getBoundingClientRect();
    return {
      left: rect.left + choice.x * rect.width,
      top: rect.top + choice.y * rect.height,
    };
  }
  return { left: window.innerWidth / 2, top: window.innerHeight / 2 };
}

export function AutofillChooserMenu(props: {
  choice: AutofillChoice;
  onSelect(item: string | null): void;
}) {
  const { choice } = props;
  const Icon = choice.kind === "card" ? CreditCard : MapPin;
  const point = pointOnPage(choice);
  return (
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) props.onSelect(null);
      }}
    >
      <Portal>
        <DropdownMenuTrigger asChild>
          <span aria-hidden="true" className="fixed size-0" style={point} />
        </DropdownMenuTrigger>
      </Portal>
      <DropdownMenuContent
        aria-label={choice.kind === "card" ? "Saved cards" : "Saved addresses"}
        data-private="true"
        className="ph-no-capture"
        align="start"
        side="bottom"
        sideOffset={0}
        collisionPadding={8}
        width="xl"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {choice.items.map((item) => (
          <MenuItem
            key={item.id}
            icon={<Icon size={17} aria-hidden="true" />}
            label={item.label || item.detail}
            // The trailing slot fits a short hint like an expiry, not a name beside an address.
            shortcut={choice.kind === "card" ? item.detail : undefined}
            onSelect={() => props.onSelect(item.id)}
          />
        ))}
        <DropdownMenuSeparator />
        <MenuItem
          icon={<Settings size={17} aria-hidden="true" />}
          label="Manage autofill"
          onSelect={() => props.onSelect(MANAGE)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Lists saved addresses or cards in Misty's own interface after the person clicks a page's fill
 * chip. Pages never receive this list: nothing reaches a site until something here is picked.
 */
export function AutofillChooser() {
  const [choice, setChoice] = useState<AutofillChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<AutofillChoice | null>(null);

  useEffect(() => {
    if (!hasTauriInternals()) return;
    let disposed = false;
    const unlisten = listen<AutofillChoice>(
      "misty://browser-autofill-choose",
      async ({ payload }) => {
        if (disposed) return;
        setError(null);
        current.current = payload;
        setBrowserWebviewsSuspended(true, suspensionReason);
        await browserOverlayReady();
        if (disposed || current.current !== payload) return;
        try {
          await getCurrentWebview().setFocus();
        } catch (reason) {
          if (current.current === payload) {
            current.current = null;
            setBrowserWebviewsSuspended(false, suspensionReason);
            setError(String(reason));
            void autofillApi.choose(payload.key, null).catch(() => undefined);
          }
          return;
        }
        if (!disposed && current.current === payload) setChoice(payload);
      },
    );
    return () => {
      disposed = true;
      void unlisten.then((stop) => stop());
      const pending = current.current;
      current.current = null;
      setBrowserWebviewsSuspended(false, suspensionReason);
      if (pending) void autofillApi.choose(pending.key, null).catch(() => undefined);
    };
  }, []);

  const select = (item: string | null) => {
    const pending = current.current;
    if (!pending) return;
    current.current = null;
    flushSync(() => setChoice(null));
    setBrowserWebviewsSuspended(false, suspensionReason);
    const manage = item === MANAGE;
    void autofillApi.choose(pending.key, manage ? null : item).catch((reason: unknown) => {
      setError(String(reason));
    });
    if (manage) openSettings("autofill");
  };

  return (
    <>
      {choice ? <AutofillChooserMenu key={choice.key} choice={choice} onSelect={select} /> : null}
      <ErrorNotification message={error} onDismiss={() => setError(null)} />
    </>
  );
}
