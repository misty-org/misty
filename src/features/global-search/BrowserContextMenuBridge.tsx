import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  CheckSquare,
  ClipboardPaste,
  Code,
  Copy,
  ExternalLink,
  Image,
  Link,
  MessageCircle,
  Reply,
  Scissors,
} from "lucide-react";
import {
  browserOverlayReady,
  setBrowserWebviewsSuspended,
} from "@/features/browser/browserRuntime";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui";
import { hasTauriInternals } from "@/shared/platform/tauri";

export interface BrowserMenuPresentation {
  key: string;
  x: number;
  y: number;
  actions: string[];
}

const entries = {
  ask: { label: "Ask Misty…", icon: MessageCircle },
  "create-task": { label: "Create task…", icon: CheckSquare },
  "prepare-reply": { label: "Prepare reply…", icon: Reply },
  "task-and-reply": { label: "Create task and reply…", icon: CheckSquare },
  copy: { label: "Copy", icon: Copy },
  cut: { label: "Cut", icon: Scissors },
  paste: { label: "Paste", icon: ClipboardPaste },
  "open-link": { label: "Open Link in Misty Browser", icon: ExternalLink },
  "copy-link": { label: "Copy Link Address", icon: Link },
  "open-image": { label: "Open Image in Misty Browser", icon: Image },
  "copy-image-link": { label: "Copy Image Address", icon: Link },
  inspect: { label: "Inspect Page", icon: Code },
};
const suspensionReason = "browser-context-menu";

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
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          className="fixed size-0"
          style={{ left: menu.x * window.innerWidth, top: menu.y * window.innerHeight }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        aria-label="Browser actions"
        align="start"
        side="bottom"
        sideOffset={0}
        collisionPadding={8}
        className="max-h-[min(560px,calc(100dvh-2rem))] w-[250px] overflow-y-auto"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {menu.actions.map((action, index) => {
          if (action === "separator") return <DropdownMenuSeparator key={`separator-${index}`} />;
          const entry = entries[action as keyof typeof entries];
          if (!entry) return null;
          const Icon = entry.icon;
          return (
            <DropdownMenuItem key={action} onSelect={() => onSelect(action)}>
              <span className="inline-flex w-[19px] items-center justify-center text-cream-muted">
                <Icon aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {entry.label}
              </span>
            </DropdownMenuItem>
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
    return () => {
      disposed = true;
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
      {error ? (
        <div
          role="alert"
          className="fixed right-4 top-16 z-[2147483400] max-w-sm rounded-md bg-charcoal-card p-3 text-sm text-cream shadow-md ring-1 ring-cream/10"
        >
          <p>{error}</p>
          <button
            className="mt-2 rounded-sm px-2 py-1 text-cream-muted hover:bg-charcoal-hover focus-visible:outline"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </>
  );
}
