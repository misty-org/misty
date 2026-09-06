import "@/styles/styles.css";
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  defineComponentApp,
  type MistyAppSDK,
  type MistyAppCommand,
  type MistyAppSettings,
  type MistyComponentContext,
  type MistyBrowserEvent,
  type MistyBrowserInspection,
} from "@misty/sdk";
import { ArrowLeft, ArrowRight, RotateCw, Pencil, MessageCirclePlus, X } from "lucide-react";
import { cn, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";
import { BrowserOmniboxView } from "@/features/browser/BrowserOmniboxView";
import { BrowserMenuView } from "@/features/browser/BrowserMenuView";
import {
  BrowserViewportMenuView,
  browserViewportWidths,
  type BrowserViewport,
} from "@/features/browser/BrowserViewportMenuView";
import { BrowserAnnotationLayerView } from "@/features/browser/BrowserAnnotationLayerView";
import { BrowserOfflinePage } from "@/features/browser/BrowserOfflinePage";
import {
  BrowserOverlayAvailability,
  useBrowserOverlay,
} from "@/features/browser/useBrowserOverlay";
import { createSdkBrowserController } from "@/features/browser/sdkBrowserController";
import { sdkBrowserSurface } from "@/features/browser/sdkBrowserSurface";
import {
  blankBrowserUrl,
  browserHomeUrl,
  browserSearchUrl,
  configureBrowserHomeUrl,
  configureBrowserSearchEngine,
} from "@/features/workspace/model";

type Services = {
  misty: MistyAppSDK;
  report(error: unknown): void;
  register(command: MistyAppCommand, action: () => void, enabled: () => boolean): () => void;
};
type View = Awaited<ReturnType<MistyAppSDK["browser"]["create"]>>;
type RuntimeState = Extract<MistyBrowserEvent, { type: "state" }>;
const emptyState: RuntimeState = {
  type: "state",
  canBack: false,
  canForward: false,
  loading: false,
  agentAccess: false,
  history: [],
  error: null,
  notice: null,
};
const iconClass =
  "grid size-8 shrink-0 place-items-center rounded-md text-cream-muted hover:bg-charcoal-hover hover:text-cream disabled:pointer-events-none disabled:opacity-35";
export function normalizeSdkBrowserAddress(value: string) {
  const text = value.trim();
  if (!text) return blankBrowserUrl;
  if (/^https?:\/\//i.test(text) || text === blankBrowserUrl) return text;
  return text.includes(".") && !text.includes(" ") ? `https://${text}` : browserSearchUrl(text);
}

export function SDKBrowserView({
  services,
  context,
}: {
  services: Services;
  context: MistyComponentContext;
}) {
  const { misty } = services;
  const host = useRef<HTMLDivElement>(null);
  const refreshLayout = useRef<() => void>(() => {});
  const controller = useRef<ReturnType<typeof createSdkBrowserController> | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [url, setUrl] = useState(blankBrowserUrl);
  const [runtime, setRuntime] = useState(emptyState);
  const [message, setMessage] = useState<string | null>(null);
  const [compatibility, setCompatibility] = useState<string | null>(null);
  const [viewport, setViewport] = useState<BrowserViewport>("responsive");
  const [annotations, setAnnotations] = useState(false);
  const [page, setPage] = useState<MistyBrowserInspection | null>(null);
  const [reading, setReading] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const latest = useRef({ context, viewport, offline });
  latest.current = { context, viewport, offline };
  const report = useCallback(
    (error: unknown) => {
      setMessage(error instanceof Error ? error.message : String(error));
      services.report(error);
    },
    [services],
  );
  const handle = view?.handle;
  const setOverlay = useCallback(
    async (reason: string, active: boolean) => {
      const current = controller.current?.view();
      if (current) await misty.browser.overlay(current.handle, reason, active);
    },
    [misty],
  );
  const agentMenu = useBrowserOverlay("agent-menu", setOverlay);
  useEffect(() => {
    const online = () => setOffline(!navigator.onLine);
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
    };
  }, []);
  useLayoutEffect(() => {
    let closed = false;
    let frame = 0;
    let lastGeometry = "";
    let resizeUntil = 0;
    const instance = createSdkBrowserController(misty.browser, {
      ready(next) {
        if (!closed) {
          setView(next);
          setUrl(next.url);
        }
      },
      error: report,
      event(event) {
        if (closed) return;
        switch (event.type) {
          case "page":
            setUrl(event.url);
            if (event.phase === "started") {
              setPage(null);
              setCompatibility(null);
            }
            break;
          case "state":
            setRuntime(event);
            break;
          case "title":
            void misty.workspace
              .setTitle(
                event.title.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160) || "Browser",
              )
              .catch(services.report);
            break;
          case "compatibility":
            setCompatibility(event.url);
            break;
          case "layout":
            lastGeometry = "";
            break;
        }
      },
    });
    controller.current = instance;
    const measure = () => {
      if (closed) return;
      const element = host.current;
      if (element) {
        const rect = element.getBoundingClientRect();
        const x = Math.max(0, rect.left),
          y = Math.max(0, rect.top);
        const width = Math.min(window.innerWidth, rect.right) - x,
          height = Math.min(window.innerHeight, rect.bottom) - y;
        const current = latest.current;
        const visible =
          current.context.active &&
          !current.offline &&
          document.visibilityState !== "hidden" &&
          width >= 2 &&
          height >= 2;
        const geometry = {
          bounds: { x, y, width: Math.max(1, width), height: Math.max(1, height) },
          visible,
          nativeLiveResize: current.viewport === "responsive",
        };
        const key = JSON.stringify(geometry);
        if (
          key !== lastGeometry &&
          (!visible || current.viewport !== "responsive" || performance.now() >= resizeUntil)
        ) {
          lastGeometry = key;
          instance.update(geometry, true);
        }
      }
      frame = requestAnimationFrame(measure);
    };
    const resize = () => {
      resizeUntil = performance.now() + 120;
      lastGeometry = "";
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      lastGeometry = "";
      measure();
    };
    refreshLayout.current = visibility;
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibility);
    frame = requestAnimationFrame(measure);
    return () => {
      closed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
      controller.current = null;
      refreshLayout.current = () => {};
      void instance.close().catch(services.report);
    };
  }, [misty, services, report]);
  useLayoutEffect(() => refreshLayout.current(), [context.active, viewport, offline]);
  useEffect(() => {
    void setOverlay("annotations", annotations).catch(report);
    return () => {
      void setOverlay("annotations", false).catch(() => undefined);
    };
  }, [annotations, setOverlay, report]);
  useEffect(() => {
    if (!context.active) {
      setAnnotations(false);
      agentMenu.onOpenChange(false);
    }
  }, [context.active, agentMenu.onOpenChange]);
  const reload = useCallback(async () => {
    if (handle) {
      setPage(null);
      await misty.browser.reload(handle);
    }
  }, [handle, misty]);
  const navigate = useCallback(
    (address: string) => {
      if (!handle) return;
      setPage(null);
      setMessage(null);
      void misty.browser.navigate(handle, normalizeSdkBrowserAddress(address)).catch(report);
    },
    [handle, misty, report],
  );
  useEffect(() => {
    const remove = [
      services.register(
        "navigation.back",
        () => {
          if (handle) {
            setPage(null);
            void misty.browser.back(handle).catch(report);
          }
        },
        () => !!handle && runtime.canBack,
      ),
      services.register(
        "navigation.forward",
        () => {
          if (handle) {
            setPage(null);
            void misty.browser.forward(handle).catch(report);
          }
        },
        () => !!handle && runtime.canForward,
      ),
      services.register(
        "navigation.refresh",
        () => {
          void reload().catch(report);
        },
        () => !!handle,
      ),
    ];
    return () => remove.forEach((stop) => stop());
  }, [services, misty, handle, runtime.canBack, runtime.canForward, reload, report]);
  const adapter = useMemo(
    () =>
      view
        ? sdkBrowserSurface({
            browser: misty.browser,
            instanceId: context.instanceId,
            ...view,
            page,
            applied: () => setPage(null),
          })
        : null,
    [view, page, misty, context.instanceId],
  );
  useEffect(() => {
    if (!adapter) return;
    let closed = false,
      cleanup: (() => void) | undefined;
    void misty.surfaces
      .register(adapter)
      .then((stop) => {
        if (closed) stop();
        else cleanup = stop;
      })
      .catch(services.report);
    return () => {
      closed = true;
      cleanup?.();
    };
  }, [adapter, misty, services]);
  const attach = async () => {
    if (!handle) return;
    setReading(true);
    try {
      setPage(await misty.browser.inspect(handle));
    } catch (error) {
      report(error);
    } finally {
      setReading(false);
    }
  };
  const notice = message || runtime.error || runtime.notice;
  return (
    <BrowserOverlayAvailability.Provider value={context.active && !!handle}>
      <section
        className="flex h-full min-h-0 flex-col overflow-hidden bg-charcoal-bg text-cream"
        data-browser-workspace-tab={context.instanceId}
      >
        <div
          className="relative z-10 flex h-11 shrink-0 items-center gap-2 border-b border-charcoal-border bg-charcoal-bg px-4"
          data-browser-toolbar
        >
          <div className="flex shrink-0 gap-1">
            <button
              className={iconClass}
              aria-label="Back"
              disabled={!handle || !runtime.canBack}
              onClick={() => {
                setPage(null);
                void misty.browser.back(handle!).catch(report);
              }}
            >
              <ArrowLeft size={20} />
            </button>
            <button
              className={iconClass}
              aria-label="Forward"
              disabled={!handle || !runtime.canForward}
              onClick={() => {
                setPage(null);
                void misty.browser.forward(handle!).catch(report);
              }}
            >
              <ArrowRight size={20} />
            </button>
            <button
              className={iconClass}
              aria-label="Reload"
              disabled={!handle}
              onClick={() => void reload().catch(report)}
            >
              <RotateCw size={20} className={runtime.loading ? "animate-spin" : undefined} />
            </button>
          </div>
          <BrowserOmniboxView
            currentUrl={url}
            historyEntries={runtime.history}
            lightChrome={false}
            suspensionReason="omnibox"
            setOverlay={setOverlay}
            onNavigate={navigate}
          />
          <div
            className={cn("flex shrink-0 gap-1", !handle && "pointer-events-none opacity-40")}
            inert={!handle}
          >
            <button
              className={iconClass}
              aria-label={annotations ? "Exit annotation mode" : "Annotate page"}
              aria-pressed={annotations}
              onClick={() => setAnnotations((value) => !value)}
            >
              <Pencil size={20} />
            </button>
            <BrowserViewportMenuView
              value={viewport}
              onChange={setViewport}
              iconButtonClass={iconClass}
              lightChrome={false}
              suspensionReason="viewport"
              setOverlay={setOverlay}
            />
            <Popover open={agentMenu.open} onOpenChange={agentMenu.onOpenChange}>
              <PopoverTrigger asChild>
                <button
                  className={iconClass}
                  aria-label={`Agent access: ${runtime.agentAccess ? "On" : "Off"}`}
                >
                  <MessageCirclePlus size={20} />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-72 p-3 data-[state=open]:animate-none data-[state=closed]:animate-none"
              >
                <p className="text-sm font-medium">Agent access</p>
                <p className="mt-1 text-xs text-cream-muted">
                  {runtime.agentAccess
                    ? "This tab is attached to active Agent work."
                    : "No active Agent run is attached to this tab."}
                </p>
                <p className="mt-3 text-xs text-cream-muted">
                  Read this page once to give Misty context for your next question.
                </p>
                <button
                  className="mt-2 w-full rounded-md border border-charcoal-border px-3 py-2 text-xs hover:bg-charcoal-hover disabled:opacity-50"
                  disabled={reading || !handle}
                  onClick={() => void attach()}
                >
                  {reading
                    ? "Reading page…"
                    : page
                      ? "Refresh page context"
                      : "Allow one-time page read"}
                </button>
                {page && (
                  <p className="mt-2 text-xs text-cream-muted">
                    Attached: {page.title}
                    {page.truncated ? " (bounded extract)" : ""}
                  </p>
                )}
              </PopoverContent>
            </Popover>
            <BrowserMenuView
              iconButtonClass={iconClass}
              url={url}
              setOverlay={setOverlay}
              reload={reload}
              reportError={report}
              openExternal={misty.links.openExternal}
              copyAddress={async () => {
                await misty.clipboard.writeText(url);
                setMessage("Address copied.");
              }}
            />
          </div>
        </div>
        {(notice || compatibility) && (
          <div
            role="status"
            className="flex shrink-0 items-center gap-2 border-b border-charcoal-border px-4 py-2 text-xs"
          >
            <span className="min-w-0 flex-1">
              {notice || "This site rejected Misty's browser verification."}
            </span>
            {!handle && message && (
              <button
                className="rounded px-2 py-1 hover:bg-charcoal-hover"
                onClick={() => {
                  setMessage(null);
                  refreshLayout.current();
                }}
              >
                Retry
              </button>
            )}
            {compatibility && (
              <button
                className="rounded px-2 py-1 hover:bg-charcoal-hover"
                onClick={() => void misty.links.openExternal(compatibility).catch(report)}
              >
                Open in browser
              </button>
            )}
            <button
              className={iconClass}
              aria-label="Dismiss browser message"
              onClick={() => {
                setMessage(null);
                setCompatibility(null);
                setRuntime((value) => ({ ...value, error: null, notice: null }));
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}
        <div className="relative min-h-0 flex-1 overflow-hidden" data-browser-page-stage>
          <div
            ref={host}
            data-browser-page-host
            data-browser-viewport={viewport}
            className={cn(
              "relative mx-auto h-full overflow-hidden",
              viewport !== "responsive" && "rounded-xl shadow-2xl ring-1 ring-black/15",
            )}
            style={{
              width: browserViewportWidths[viewport]
                ? `min(100%, ${browserViewportWidths[viewport]}px)`
                : "100%",
            }}
          >
            {offline && (
              <BrowserOfflinePage
                url={url}
                onRetry={() => void reload().catch(report)}
                onGoHome={() => navigate(browserHomeUrl())}
              />
            )}
            <BrowserAnnotationLayerView
              active={annotations}
              lightChrome={false}
              onClose={() => setAnnotations(false)}
              registerCommand={services.register}
            />
          </div>
        </div>
      </section>
    </BrowserOverlayAvailability.Provider>
  );
}

export default defineComponentApp({
  appId: "browser",
  protocol: 2,
  async mount({ root, misty, context: initialContext, signal }) {
    let context = initialContext,
      closed = false;
    const removers = new Set<() => void>();
    let reactRoot: ReturnType<typeof createRoot> | undefined;
    const report = (error: unknown) => {
      if (!closed) void misty.activity.report(String(error).slice(0, 2000)).catch(() => undefined);
    };
    const subscribe = (start: () => Promise<() => void>) => {
      let removed = false,
        stop: (() => void) | undefined;
      const remove = () => {
        removed = true;
        stop?.();
        removers.delete(remove);
      };
      removers.add(remove);
      void start()
        .then((cleanup) => {
          if (removed || closed) cleanup();
          else stop = cleanup;
        })
        .catch(report);
      return remove;
    };
    const services: Services = {
      misty,
      report,
      register: (command, action, enabled) =>
        subscribe(() =>
          misty.shortcuts.register(command, () => {
            if (!closed && (context.focused ?? context.active) && enabled()) action();
          }),
        ),
    };
    const render = () => {
      if (!closed) reactRoot?.render(<SDKBrowserView services={services} context={context} />);
    };
    const settings = (next: MistyAppSettings) => {
      if (!next.browser)
        throw new Error("This version of Misty does not provide Browser settings.");
      configureBrowserHomeUrl(next.browser.homeUrl);
      configureBrowserSearchEngine(next.browser.searchEngineIndex);
      render();
    };
    const dispose = () => {
      if (closed) return;
      closed = true;
      for (const remove of [...removers]) remove();
      reactRoot?.unmount();
      signal?.removeEventListener("abort", dispose);
    };
    try {
      settings(await misty.settings.snapshot());
      if (signal?.aborted) throw new Error("Browser closed while loading.");
      reactRoot = createRoot(root);
      render();
      subscribe(() => misty.settings.subscribe(settings));
      signal?.addEventListener("abort", dispose, { once: true });
      return {
        update(next) {
          context = next;
          render();
        },
        unmount: dispose,
      };
    } catch (error) {
      dispose();
      throw error;
    }
  },
});
