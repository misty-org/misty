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
  Columns2,
  Copy,
  ExternalLink,
  Eye,
  Highlighter,
  Image,
  Link,
  MessageCircle,
  Puzzle,
  QrCode,
  RotateCw,
  Scissors,
  Search,
  Star,
} from "lucide-react";
import {
  browserOverlayReady,
  browserRuntimeIdForTabId,
  browserTabShowsInternalPage,
  setBrowserWebviewsSuspended,
} from "@/features/webviews/browserRuntime";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuItem,
  Portal,
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
  copy: { label: "Copy", icon: Copy },
  cut: { label: "Cut", icon: Scissors },
  paste: { label: "Paste", icon: ClipboardPaste },
  "search-web": { label: "Search the Web for Selection", icon: Search },
  "open-link": { label: "Open Link in New Tab", icon: ExternalLink },
  "open-link-split": { label: "Open Link in Split View", icon: Columns2 },
  "peek-link": { label: "Peek Link", icon: Eye },
  "copy-link": { label: "Copy Link Address", icon: Link },
  "open-image": { label: "Open Image in New Tab", icon: Image },
  "copy-image-link": { label: "Copy Image Address", icon: Link },
  back: { label: "Back", icon: ArrowLeft },
  forward: { label: "Forward", icon: ArrowRight },
  reload: { label: "Reload", icon: RotateCw },
  bookmark: { label: "Bookmark Page…", icon: Star },
  "copy-page-link": { label: "Copy Page Link", icon: Link },
  "qr-code": { label: "QR Code for Page…", icon: QrCode },
  annotate: { label: "Annotate Page", icon: Highlighter },
  extensions: { label: "Extensions", icon: Puzzle },
  inspect: { label: "Inspect Page", icon: Code },
};
const suspensionReason = "browser-context-menu";

/**
 * The native page beneath a renderer point, as fractions of its bounds. While
 * a renderer overlay is open the page sits under the renderer, which then
 * receives clicks over it. Only the transparent path to the page counts:
 * anything the renderer draws there itself (internal pages, annotations,
 * notifications, the menu) keeps its own click.
 */
export function browserPageAtPoint(
  target: EventTarget | null,
  clientX: number,
  clientY: number,
  root: ParentNode = document,
): { id: string; x: number; y: number } | null {
  if (!(target instanceof Element)) return null;
  for (const host of root.querySelectorAll<HTMLElement>("[data-browser-page-host]")) {
    if (!target.contains(host)) continue;
    const rect = host.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      continue;
    }
    const tabId = host
      .closest("[data-browser-workspace-tab]")
      ?.getAttribute("data-browser-workspace-tab");
    if (!tabId || browserTabShowsInternalPage(tabId)) return null;
    const id = browserRuntimeIdForTabId(tabId);
    if (!id) return null;
    return {
      id,
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    };
  }
  return null;
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
        {menu.actions.map((action, index) => {
          if (action === "separator") return <DropdownMenuSeparator key={`separator-${index}`} />;
          const entry = entries[action as keyof typeof entries];
          if (!entry) return null;
          const Icon = entry.icon;
          return (
            <MenuItem
              key={action}
              icon={<Icon size={17} aria-hidden="true" />}
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
    // A right-click on a page under the renderer would otherwise get the
    // renderer's own engine menu. Hand it to the page so this menu reopens there.
    const forwardContextMenu = (event: MouseEvent) => {
      const page = browserPageAtPoint(event.target, event.clientX, event.clientY);
      if (!page) return;
      event.preventDefault();
      void invoke("browser_webview_context_menu_at", { request: page }).catch(() => undefined);
    };
    window.addEventListener("contextmenu", forwardContextMenu, true);
    return () => {
      disposed = true;
      window.removeEventListener("contextmenu", forwardContextMenu, true);
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
          className="fixed right-4 top-16 layer-menu max-w-sm rounded-md bg-charcoal-card p-3 text-sm text-cream shadow-md ring-1 ring-cream/10"
        >
          <p>{error}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 text-cream-muted"
            onClick={() => setError(null)}
          >
            Dismiss
          </Button>
        </div>
      ) : null}
    </>
  );
}
