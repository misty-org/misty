import {
  blankBrowserUrl,
  browserSearchUrl,
  browserTabTitle,
  createBrowserTabState,
  parseBrowserTabState,
  type WorkspaceTab,
  dockLeaves,
  useWorkspaceStore,
} from "@/features/workspace";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { cn, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, ArrowRight, MessageCirclePlus, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  browserRuntimeCreated,
  browserRuntimeId,
  setBrowserWebviewsSuspended,
  useBrowserRuntimeStore,
} from "./browserRuntime";
import { BrowserMenu } from "./BrowserMenu";
import { useBrowserWebviewGeometry } from "./useBrowserWebviewGeometry";
import type { BrowserTheme } from "./types";

export { browserBoundsAtAppZoom } from "./useBrowserWebviewGeometry";

function displayBrowserAddress(value: string): string {
  return value === blankBrowserUrl ? "" : value;
}

function toolbarAddress(value: string): string {
  if (value === blankBrowserUrl) return "Search or enter URL";
  try {
    return new URL(value).hostname.replace(/^www\./, "") || value;
  } catch {
    return value;
  }
}

function browserThemeFromDocument(): BrowserTheme {
  const theme = document.documentElement.dataset.theme;
  if (theme === "light" || theme === "dark") return theme;
  return typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function normalizeBrowserAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return blankBrowserUrl;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.includes(".") && !trimmed.includes(" ")) return `https://${trimmed}`;
  return browserSearchUrl(trimmed);
}

export function BrowserWorkspace(props: { tab?: WorkspaceTab }) {
  const fallbackTab = useWorkspaceStore((store) => {
    const panes = dockLeaves(store.layout.root);
    const pane = panes.find((candidate) => candidate.id === store.layout.focusedPaneId) ?? panes[0];
    const candidate = pane?.tabs.find((item) => item.id === pane.activeTabId);
    return candidate?.surfaceId === "browser" ? candidate : undefined;
  });
  const tab = props.tab ?? fallbackTab;
  if (!tab) {
    return (
      <div className="grid h-full place-items-center bg-charcoal-bg text-sm text-cream-muted">
        Open a browser tab to begin.
      </div>
    );
  }
  return <ActiveBrowserWorkspace tab={tab} />;
}

function ActiveBrowserWorkspace({ tab }: { tab: WorkspaceTab }) {
  const nativeRuntime = hasTauriInternals();
  const state = parseBrowserTabState(tab.state);
  const pageHostRef = useRef<HTMLDivElement | null>(null);
  const [draftAddress, setDraftAddress] = useState(() => displayBrowserAddress(state.url));
  const [addressFocused, setAddressFocused] = useState(false);
  const [browserTheme, setBrowserTheme] = useState<BrowserTheme>(browserThemeFromDocument);
  const storedGrants = useBrowserRuntimeStore((runtime) => runtime.grants[tab.id]);
  const storedHistory = useBrowserRuntimeStore((runtime) => runtime.histories[tab.id]);
  const grants = storedGrants ?? [];
  const history = storedHistory ?? { entries: [state.url], index: 0 };
  const runtimeError = useBrowserRuntimeStore((runtime) => runtime.errors[tab.id] ?? null);
  const downloadNotice = useBrowserRuntimeStore((runtime) => runtime.notices[tab.id] ?? null);
  const browserMessageVisible = Boolean(runtimeError || downloadNotice);
  const lightChrome = browserTheme === "light";
  const iconButtonClass = codexIconButtonClass(lightChrome);
  const agentAccess = grants.length > 0;
  const agentMenuSuspensionReason = `browser-agents:${browserRuntimeId(tab)}`;

  useBrowserWebviewGeometry({
    hostRef: pageHostRef,
    nativeRuntime,
    tab,
    url: state.url,
    theme: browserTheme,
  });

  useEffect(() => {
    useBrowserRuntimeStore.getState().ensureHistory(tab.id, state.url);
  }, [state.url, tab.id]);

  useEffect(() => {
    if (!addressFocused) setDraftAddress(displayBrowserAddress(state.url));
  }, [addressFocused, state.url]);

  useEffect(() => {
    const root = document.documentElement;
    const colorScheme =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: light)")
        : null;
    const syncTheme = () => setBrowserTheme(browserThemeFromDocument());
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "data-theme-mode"],
    });
    colorScheme?.addEventListener("change", syncTheme);
    return () => {
      observer.disconnect();
      colorScheme?.removeEventListener("change", syncTheme);
    };
  }, []);

  useEffect(() => {
    if (!nativeRuntime) return;
    void invoke("browser_webview_set_theme", { request: { theme: browserTheme } }).catch(
      (error: unknown) => setBrowserError(tab.id, error),
    );
  }, [browserTheme, nativeRuntime, tab.id]);

  useEffect(() => {
    return () => setBrowserWebviewsSuspended(false, agentMenuSuspensionReason);
  }, [agentMenuSuspensionReason]);

  const navigateActiveTab = (rawAddress: string) => {
    const url = normalizeBrowserAddress(rawAddress);
    setDraftAddress(displayBrowserAddress(url));
    useWorkspaceStore.getState().updateBrowserTab(tab.id, {
      ...createBrowserTabState(url),
      title: browserTabTitle(url),
    });
    useBrowserRuntimeStore.getState().pushHistory(tab.id, url);
    if (nativeRuntime && browserRuntimeCreated(tab)) {
      void invoke("browser_webview_navigate", {
        request: { id: browserRuntimeId(tab), url },
      }).catch((error: unknown) => setBrowserError(tab.id, error));
    }
  };

  const travel = (direction: -1 | 1) => {
    const url = useBrowserRuntimeStore.getState().moveHistory(tab.id, direction);
    if (!url) return;
    useWorkspaceStore.getState().updateBrowserTab(tab.id, {
      url,
      title: browserTabTitle(url),
    });
    setDraftAddress(displayBrowserAddress(url));
    if (nativeRuntime) {
      void invoke(direction < 0 ? "browser_webview_back" : "browser_webview_forward", {
        request: { id: browserRuntimeId(tab) },
      }).catch((error: unknown) => setBrowserError(tab.id, error));
    }
  };

  return (
    <section
      className={cn(
        "grid h-full min-h-0 overflow-hidden",
        browserMessageVisible
          ? "grid-rows-[44px_auto_minmax(0,1fr)]"
          : "grid-rows-[44px_minmax(0,1fr)]",
        lightChrome ? "bg-[#f7f7f7] text-[#202020]" : "bg-[#171717] text-cream",
      )}
      data-browser-theme={browserTheme}
      data-browser-workspace-tab={tab.id}
    >
      <div
        className={cn(
          "relative flex items-center border-b px-4",
          lightChrome ? "border-black/[0.08] bg-[#f7f7f7]" : "border-white/[0.055] bg-[#171717]",
        )}
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={iconButtonClass}
            aria-label="Back"
            disabled={history.index === 0}
            onClick={() => travel(-1)}
          >
            <ArrowLeft size={20} strokeWidth={1.6} />
          </button>
          <button
            type="button"
            className={iconButtonClass}
            aria-label="Forward"
            disabled={history.index >= history.entries.length - 1}
            onClick={() => travel(1)}
          >
            <ArrowRight size={20} strokeWidth={1.6} />
          </button>
          <button
            type="button"
            className={iconButtonClass}
            aria-label="Reload"
            onClick={() => {
              if (nativeRuntime) {
                void invoke("browser_webview_reload", {
                  request: { id: browserRuntimeId(tab) },
                }).catch((error: unknown) => setBrowserError(tab.id, error));
              }
            }}
          >
            <RefreshCw size={20} strokeWidth={1.7} />
          </button>
        </div>

        <form
          className="absolute left-1/2 top-1/2 w-[min(44vw,440px)] -translate-x-1/2 -translate-y-1/2"
          onSubmit={(event) => {
            event.preventDefault();
            navigateActiveTab(draftAddress);
            setAddressFocused(false);
            event.currentTarget.querySelector("input")?.blur();
          }}
        >
          <input
            value={addressFocused ? draftAddress : toolbarAddress(state.url)}
            onChange={(event) => setDraftAddress(event.target.value)}
            onFocus={(event) => {
              const input = event.currentTarget;
              setAddressFocused(true);
              setDraftAddress(displayBrowserAddress(state.url));
              window.requestAnimationFrame(() => input.select());
            }}
            onPointerDown={(event) => {
              if (document.activeElement === event.currentTarget) return;
              const input = event.currentTarget;
              event.preventDefault();
              input.focus();
              window.requestAnimationFrame(() => input.select());
            }}
            onBlur={() => setAddressFocused(false)}
            aria-label="Search or enter address"
            className={cn(
              "h-9 w-full rounded-lg border border-transparent bg-transparent px-3 text-center text-[16px] outline-none transition-colors",
              lightChrome
                ? "text-[#252525] hover:bg-black/[0.025] focus:border-black/[0.09] focus:bg-[#ededed] focus:text-left"
                : "text-[#e7e7e7] hover:bg-white/[0.025] focus:border-white/[0.08] focus:bg-[#222] focus:text-left",
            )}
          />
        </form>

        <div className="ml-auto flex items-center gap-1">
          <Popover
            onOpenChange={(open) => {
              if (nativeRuntime) {
                setBrowserWebviewsSuspended(open, agentMenuSuspensionReason);
              }
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  iconButtonClass,
                  agentAccess &&
                    (lightChrome
                      ? "bg-black/[0.06] text-[#202020]"
                      : "bg-white/[0.06] text-[#e9e9e9]"),
                )}
                aria-label={`Agent access: ${agentAccess ? "On" : "Off"}`}
              >
                <MessageCirclePlus size={20} strokeWidth={1.7} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={8} className="w-72 p-3">
              <p className="m-0 text-sm font-medium">Run-bound Agent access</p>
              <p className="mb-3 mt-1 text-xs text-cream-muted">
                Attach this tab when you ask an Agent to work. Access belongs only to that run,
                stays inside its Space, and expires automatically.
              </p>
              <p className="m-0 text-xs text-cream-muted">
                {agentAccess
                  ? "This tab is attached to active Agent work."
                  : "No active Agent run is attached to this tab."}
              </p>
            </PopoverContent>
          </Popover>
          <BrowserMenu
            iconButtonClass={iconButtonClass}
            nativeRuntime={nativeRuntime}
            tab={tab}
            url={state.url}
          />
        </div>
      </div>

      {runtimeError || downloadNotice ? (
        <div
          className={cn(
            "border-b px-4 py-1.5 text-xs",
            runtimeError
              ? "border-notification-red/25 bg-notification-red/10 text-cream"
              : "border-emerald-500/20 bg-emerald-500/10 text-cream",
          )}
          role={runtimeError ? "alert" : "status"}
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{runtimeError ?? downloadNotice}</span>
            <button
              type="button"
              className="grid size-5 shrink-0 place-items-center rounded hover:bg-white/10"
              aria-label="Dismiss browser message"
              onClick={() => {
                useBrowserRuntimeStore.getState().setError(tab.id, null);
                useBrowserRuntimeStore.getState().setNotice(tab.id, null);
              }}
            >
              <X size={13} />
            </button>
          </div>
        </div>
      ) : null}

      <div
        ref={pageHostRef}
        className={cn(
          "relative min-h-0 min-w-0 overflow-hidden",
          lightChrome ? "bg-white" : "bg-[#202124]",
        )}
        data-browser-page-host
      >
        {!nativeRuntime && state.url !== blankBrowserUrl ? (
          <iframe
            title={tab.title}
            src={state.url}
            className="absolute inset-0 size-full border-0"
          />
        ) : null}
      </div>
    </section>
  );
}

function setBrowserError(tabId: string, error: unknown) {
  useBrowserRuntimeStore
    .getState()
    .setError(tabId, error instanceof Error ? error.message : String(error));
}

function codexIconButtonClass(light: boolean): string {
  return cn(
    "grid size-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent p-0",
    "transition-colors focus-visible:outline-none focus-visible:ring-2",
    light
      ? "text-[#6d6d6d] hover:bg-black/[0.045] hover:text-[#222] focus-visible:ring-black/15 disabled:text-[#b9b9b9]"
      : "text-[#8f8f8f] hover:bg-white/[0.045] hover:text-[#dddddd] focus-visible:ring-white/15 disabled:text-[#4e4e4e]",
    "disabled:pointer-events-none",
  );
}
