import { needsModelKey } from "../../models/ModelKeyNeeded";
import { openModelSettings } from "../../models/modelKeys";
import { ErrorNotice } from "../ErrorNotice";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  ArrowLeft,
  ArrowRight,
  ClipboardPaste,
  Code,
  Copy,
  Link,
  RotateCw,
  Scissors,
} from "lucide-react";
import { browserOverlayReady, setBrowserWebviewsSuspended } from "@/features/app-windows";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuItem,
  Portal,
} from "@/shared/ui";
import { hasTauriInternals } from "@/shared/platform/tauri";

interface BrowserMenuPresentation {
  key: string;
  x: number;
  y: number;
  actions: string[];
}

const entries = {
  copy: { label: "Copy", icon: Copy },
  cut: { label: "Cut", icon: Scissors },
  paste: { label: "Paste", icon: ClipboardPaste },
  "copy-link": { label: "Copy link address", icon: Link },
  "copy-image-link": { label: "Copy image address", icon: Link },
  back: { label: "Back", icon: ArrowLeft },
  forward: { label: "Forward", icon: ArrowRight },
  reload: { label: "Reload", icon: RotateCw },
  "copy-page-link": { label: "Copy link", icon: Link },
  inspect: { label: "Inspect", icon: Code },
};
const suspensionReason = "browser-context-menu";

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input,textarea,[contenteditable="true"],[role="textbox"]') !== null
  );
}

export function BrowserContextMenuView({
  menu,
  onSelect,
}: {
  menu: BrowserMenuPresentation;
  onSelect: (action: string) => void;
}) {
  return (
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) onSelect("dismiss");
      }}
    >
      <Portal>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden="true"
            className="fixed size-0"
            style={{ left: menu.x * window.innerWidth, top: menu.y * window.innerHeight }}
          />
        </DropdownMenuTrigger>
      </Portal>
      <DropdownMenuContent
        aria-label="Browser actions"
        // Opens at the pointer, so it fades in place rather than sliding.
        data-popup-at-pointer=""
        align="start"
        side="bottom"
        sideOffset={0}
        collisionPadding={8}
        width="lg"
        // Stay within the space left in the window so the last items (Inspect
        // Page, Extensions) scroll into view instead of running off-screen.
        className="max-h-[min(560px,var(--radix-dropdown-menu-content-available-height))]"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {menu.actions
          // A separator never comes first, last or doubled.
          .filter(
            (action, index, all) =>
              action !== "separator" ||
              (index > 0 && index < all.length - 1 && all[index - 1] !== "separator"),
          )
          .map((action, index) => {
            if (action === "separator") return <DropdownMenuSeparator key={`separator-${index}`} />;
            const entry = entries[action as keyof typeof entries];
            if (!entry) return null;
            const Icon = entry.icon;
            return (
              <MenuItem
                key={action}
                icon={<Icon aria-hidden="true" />}
                label={entry.label}
                onSelect={() => onSelect(action)}
              />
            );
          })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BrowserContextMenuBridge() {
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<BrowserMenuPresentation | null>(null);
  const current = useRef<BrowserMenuPresentation | null>(null);
  useEffect(() => {
    if (!hasTauriInternals()) return;
    let disposed = false;
    const unlisten = listen<BrowserMenuPresentation>(
      "misty://browser-context-menu",
      async ({ payload }) => {
        if (disposed) return;
        setError(null);
        current.current = payload;
        setBrowserWebviewsSuspended(true, suspensionReason);
        await browserOverlayReady();
        if (disposed || current.current !== payload) return;
        try {
          await getCurrentWebview().setFocus();
        } catch (error) {
          if (current.current === payload) {
            current.current = null;
            setBrowserWebviewsSuspended(false, suspensionReason);
            setError(String(error));
            void invoke("browser_context_menu_select", {
              key: payload.key,
              action: "dismiss",
            }).catch(() => undefined);
          }
          return;
        }
        if (!disposed && current.current === payload) setMenu(payload);
      },
    );
    // While Misty's menu for a page is on its way or open, the renderer's own engine menu would
    // open beside it for a few frames, so it never shows then. Fields keep theirs.
    const suppressEngineMenu = (event: MouseEvent) => {
      if (current.current && !isEditableTarget(event.target)) event.preventDefault();
    };
    window.addEventListener("contextmenu", suppressEngineMenu, true);
    return () => {
      disposed = true;
      window.removeEventListener("contextmenu", suppressEngineMenu, true);
      void unlisten.then((stop) => stop());
      const pending = current.current;
      current.current = null;
      setBrowserWebviewsSuspended(false, suspensionReason);
      if (pending)
        void invoke("browser_context_menu_select", { key: pending.key, action: "dismiss" }).catch(
          () => undefined,
        );
    };
  }, []);

  const select = (action: string) => {
    const pending = current.current;
    if (!pending) return;
    current.current = null;
    // Unmount the modal layer before Ask or another surface acquires focus.
    flushSync(() => setMenu(null));
    setBrowserWebviewsSuspended(false, suspensionReason);
    void invoke("browser_context_menu_select", { key: pending.key, action }).catch(
      (error: unknown) => {
        if (action !== "dismiss") setError(String(error));
      },
    );
  };
  return (
    <>
      {menu ? <BrowserContextMenuView key={menu.key} menu={menu} onSelect={select} /> : null}
      <ErrorNotice
        message={error}
        action={
          needsModelKey(error)
            ? {
                label: "Open Models settings",
                onSelect: () => {
                  setError(null);
                  openModelSettings();
                },
              }
            : undefined
        }
        onDismiss={() => setError(null)}
      />
    </>
  );
}
