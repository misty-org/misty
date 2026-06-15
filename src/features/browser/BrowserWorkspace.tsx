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
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";
import {
  useAiSurfaceAdapter,
  type AiArtifact,
  type AiSurfaceAdapter,
} from "@/features/ai-surface/AiPaneHost";
import { useShortcutHandler } from "@/features/shortcuts";
import { SystemErrorActivity } from "@/features/activity";
import { cn, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";
import { useMobileSurfaceChrome } from "@/shared/mobile";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  MessageCirclePlus,
  Pencil,
  RotateCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  browserContentHash,
  browserRuntimeCreated,
  browserRuntimeId,
  browserScopeId,
  setBrowserWebviewsSuspended,
  useBrowserRuntimeStore,
  type BrowserInspection,
  type BrowserMistyPage,
} from "./browserRuntime";
import { BrowserMenu } from "./BrowserMenu";
import { BrowserAnnotationLayer } from "./BrowserAnnotationLayer";
import { BrowserOfflinePage } from "./BrowserOfflinePage";
import { useBrowserOnlineStatus } from "./useBrowserOnlineStatus";
import {
  browserViewportWidths,
  BrowserViewportMenu,
  type BrowserViewport,
} from "./BrowserViewportMenu";
import { useBrowserWebviewGeometry } from "./useBrowserWebviewGeometry";
import { useBrowserOverlayControl } from "./useBrowserOverlayControl";
import { BrowserOmnibox } from "./BrowserOmnibox";
import type { BrowserTheme } from "./types";

export { browserBoundsAtAppZoom } from "./useBrowserWebviewGeometry";

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
  useMobileSurfaceChrome({ title: tab.title || browserTabTitle(state.url), level: "root" });
  const pageHostRef = useRef<HTMLDivElement | null>(null);
  const [browserTheme, setBrowserTheme] = useState<BrowserTheme>(browserThemeFromDocument);
  const [annotationsActive, setAnnotationsActive] = useState(false);
  const [viewport, setViewport] = useState<BrowserViewport>("responsive");
  const [mistyPage, setMistyPage] = useState<BrowserMistyPage | null>(null);
  const [mistyPageLoading, setMistyPageLoading] = useState(false);
  const storedGrants = useBrowserRuntimeStore((runtime) => runtime.grants[tab.id]);
  const storedHistory = useBrowserRuntimeStore((runtime) => runtime.histories[tab.id]);
  const grants = storedGrants ?? [];
  const history = storedHistory ?? { entries: [state.url], index: 0 };
  const runtimeError = useBrowserRuntimeStore((runtime) => runtime.errors[tab.id] ?? null);
  const downloadNotice = useBrowserRuntimeStore((runtime) => runtime.notices[tab.id] ?? null);
  const compatibilityIssue = useBrowserRuntimeStore(
    (runtime) => runtime.compatibilityIssues[tab.id] ?? null,
  );
  const { isOffline, handleRetry, handleGoHome } = useBrowserOnlineStatus(
    tab,
    state.url,
    nativeRuntime,
  );
  const lightChrome = false;
  const browserChromeBackground = "#18191c";
  const browserMessageVisible = Boolean(runtimeError || downloadNotice || compatibilityIssue);
  const iconButtonClass = codexIconButtonClass(lightChrome);
  const agentAccess = grants.length > 0;
  const annotationSuspensionReason = `browser-annotations:${browserRuntimeId(tab)}`;
  const agentMenuSuspensionReason = `browser-agent-menu:${browserRuntimeId(tab)}`;
  const viewportMenuSuspensionReason = `browser-viewport-menu:${browserRuntimeId(tab)}`;
  const viewportWidth = browserViewportWidths[viewport];
  const agentMenuOverlay = useBrowserOverlayControl(agentMenuSuspensionReason);
  const aiAdapter = useMemo<AiSurfaceAdapter>(() => {
    const scopeId = browserScopeId(tab);
    const content = mistyPage
      ? [
          mistyPage.text.slice(0, 28 << 10),
          `Visible interactive controls (opaque references):\n${JSON.stringify(mistyPage.interactive)}`,
        ]
          .join("\n\n")
          .slice(0, 32 << 10)
      : "";
    const applicableAction = (artifact: AiArtifact) => {
      if (
        artifact.kind !== "browser_action" ||
        !nativeRuntime ||
        !browserRuntimeCreated(tab) ||
        !mistyPage ||
        artifact.baseRevision !== mistyPage.urlFingerprint
      )
        return null;
      const operations = artifact.operations as {
        tab_scope_id?: string;
        steps?: Array<{ action?: string; target?: string; value?: string; effect?: string }>;
      };
      if (operations.tab_scope_id !== scopeId || operations.steps?.length !== 1) return null;
      const step = operations.steps[0];
      if (step.action === "navigate" && typeof step.value === "string") {
        try {
          const url = new URL(step.value);
          return url.protocol === "https:" || url.protocol === "http:"
            ? { operation: "browser.navigate", input: { url: url.toString() } }
            : null;
        } catch {
          return null;
        }
      }
      if (
        step.action === "click" &&
        typeof step.target === "string" &&
        mistyPage.interactive.some((control) => control.ref === step.target)
      ) {
        return {
          operation: "browser.click",
          input: { elementRef: step.target, expectDownload: false },
        };
      }
      return null;
    };
    return {
      surfaceId: "browser",
      label: mistyPage?.title || tab.title || "this browser tab",
      getContext: () => [
        {
          kind: "browser-tab",
          id: tab.id,
          title: mistyPage?.title || tab.title || "Browser tab",
          privacy: "device",
          opaqueScopeId: scopeId,
          revision: mistyPage?.urlFingerprint,
          attached: Boolean(mistyPage),
        },
      ],
      getSelection: () =>
        mistyPage
          ? {
              kind: "blocks",
              content,
              object: {
                kind: "browser-page",
                id: scopeId,
                revision: mistyPage.urlFingerprint,
              },
              anchors: { capture: "visible-page-text", truncated: mistyPage.truncated },
              contentHash: browserContentHash(content),
            }
          : null,
      getSuggestedActions: () =>
        mistyPage
          ? [
              {
                id: "browser.summary",
                label: "Summarize page",
                prompt: "Summarize this page and cite the page context for the key claims.",
                trigger: "object",
              },
              {
                id: "browser.explain",
                label: "Explain page",
                prompt:
                  "Explain this page in plain language, including its main argument and caveats.",
                trigger: "object",
              },
              {
                id: "browser.extract",
                label: "Extract key facts",
                prompt:
                  "Extract the most important facts from this page. Separate page claims from your inference.",
                trigger: "object",
              },
              {
                id: "browser.next-action",
                label: "Review next action",
                prompt:
                  "Propose exactly one navigation or click using the current opaque tab scope and an explicitly listed control " +
                  "reference or URL. Explain the visible effect. Do not execute it.",
                trigger: "object",
                requestedArtifactKind: "browser_action",
              },
            ]
          : [],
      canApply: (artifact) => Boolean(applicableAction(artifact)),
      applyArtifact: async (artifact) => {
        const action = applicableAction(artifact);
        if (!action)
          throw new Error(
            "The page or browser scope changed. Ask Misty to regenerate this action.",
          );
        const grantId = `misty-action-${crypto.randomUUID()}`;
        const agentId = "misty-contextual-copilot";
        try {
          await invoke("browser_agent_grant_register", {
            request: {
              id: browserRuntimeId(tab),
              scopeId,
              grantId,
              agentId,
              capabilities: [action.operation],
              expiresAt: new Date(Date.now() + 30_000).toISOString(),
            },
          });
          await invoke("browser_agent_execute", {
            request: {
              scopeId,
              grantId,
              agentId,
              operation: action.operation,
              input: action.input,
            },
          });
          if (action.operation === "browser.navigate") {
            const url = String((action.input as { url: string }).url);
            useWorkspaceStore.getState().updateBrowserTab(tab.id, {
              ...createBrowserTabState(url),
              title: browserTabTitle(url),
            });
            useBrowserRuntimeStore.getState().pushHistory(tab.id, url);
          }
        } finally {
          await invoke("browser_agent_grant_revoke", {
            request: { id: browserRuntimeId(tab), grantId },
          }).catch(() => undefined);
        }
      },
    };
  }, [mistyPage, nativeRuntime, tab]);
  useAiSurfaceAdapter(aiAdapter);

  useBrowserWebviewGeometry({
    hostRef: pageHostRef,
    nativeRuntime,
    nativeLiveResize: !isNativeMobileBuild && viewport === "responsive",
    tab,
    url: state.url,
    theme: browserTheme,
    offline: isOffline,
  });

  useEffect(() => {
    useBrowserRuntimeStore.getState().ensureHistory(tab.id, state.url);
  }, [state.url, tab.id]);

  useEffect(() => setMistyPage(null), [state.url]);

  useEffect(() => {
    if (!runtimeError && !downloadNotice) return;
    const timer = window.setTimeout(() => {
      useBrowserRuntimeStore.getState().setError(tab.id, null);
      useBrowserRuntimeStore.getState().setNotice(tab.id, null);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [runtimeError, downloadNotice, tab.id]);

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
    setBrowserWebviewsSuspended(annotationsActive, annotationSuspensionReason);
    return () => setBrowserWebviewsSuspended(false, annotationSuspensionReason);
  }, [annotationSuspensionReason, annotationsActive]);

  const navigateActiveTab = (rawAddress: string) => {
    const url = normalizeBrowserAddress(rawAddress);
    useWorkspaceStore.getState().updateBrowserTab(tab.id, {
      ...createBrowserTabState(url),
      title: browserTabTitle(url),
    });
    useBrowserRuntimeStore.getState().pushHistory(tab.id, url);
    useBrowserRuntimeStore.getState().setLoading(tab.id, true);
    if (nativeRuntime && browserRuntimeCreated(tab)) {
      void invoke("browser_webview_navigate", {
        request: { id: browserRuntimeId(tab), url },
      }).catch((error: unknown) => setBrowserError(tab.id, error));
    }
  };

  const attachPageToMisty = async () => {
    if (!nativeRuntime || !browserRuntimeCreated(tab)) {
      setBrowserError(
        tab.id,
        "Page context is unavailable on this platform or before the page opens.",
      );
      return;
    }
    setMistyPageLoading(true);
    const grantId = `misty-page-${crypto.randomUUID()}`;
    const agentId = "misty-contextual-copilot";
    const scopeId = browserScopeId(tab);
    try {
      await invoke("browser_agent_grant_register", {
        request: {
          id: browserRuntimeId(tab),
          scopeId,
          grantId,
          agentId,
          capabilities: ["browser.inspect"],
          expiresAt: new Date(Date.now() + 2 * 60_000).toISOString(),
        },
      });
      const snapshot = await invoke<BrowserInspection>("browser_agent_execute", {
        request: {
          scopeId,
          grantId,
          agentId,
          operation: "browser.inspect",
          input: {},
        },
      });
      const text = String(snapshot.text ?? "").slice(0, 32 * 1024);
      if (!text.trim()) throw new Error("The page did not expose readable text.");
      setMistyPage({
        title: String(snapshot.title || tab.title || "Browser page"),
        text,
        truncated: Boolean(snapshot.truncated) || String(snapshot.text ?? "").length > text.length,
        urlFingerprint: browserContentHash(String(snapshot.url || state.url)),
        interactive: (snapshot.interactive ?? []).slice(0, 100),
      });
    } catch (error) {
      setBrowserError(tab.id, error);
    } finally {
      await invoke("browser_agent_grant_revoke", {
        request: { id: browserRuntimeId(tab), grantId },
      }).catch(() => undefined);
      setMistyPageLoading(false);
    }
  };

  const travel = (direction: -1 | 1): boolean => {
    const url = useBrowserRuntimeStore.getState().moveHistory(tab.id, direction);
    if (!url) return false;
    useWorkspaceStore.getState().updateBrowserTab(tab.id, {
      url,
      title: browserTabTitle(url),
    });
    useBrowserRuntimeStore.getState().setLoading(tab.id, true);
    if (nativeRuntime) {
      void invoke(direction < 0 ? "browser_webview_back" : "browser_webview_forward", {
        request: { id: browserRuntimeId(tab) },
      }).catch((error: unknown) => setBrowserError(tab.id, error));
    }
    return true;
  };
  const focused = () => {
    const workspace = useWorkspaceStore.getState();
    const pane = dockLeaves(workspace.layout.root).find(
      (candidate) => candidate.id === workspace.layout.focusedPaneId,
    );
    return pane?.activeTabId === tab.id;
  };
  useShortcutHandler("navigation.back", () => travel(-1), focused, 100);
  useShortcutHandler("navigation.forward", () => travel(1), focused, 100);
  useShortcutHandler(
    "navigation.refresh",
    () => {
      if (!nativeRuntime) return false;
      useBrowserRuntimeStore.getState().setLoading(tab.id, true);
      void invoke("browser_webview_reload", {
        request: { id: browserRuntimeId(tab) },
      }).catch((error: unknown) => setBrowserError(tab.id, error));
      return true;
    },
    focused,
    100,
  );

  return (
    <section
      className={cn(
        "grid h-full min-h-0 overflow-hidden",
        browserMessageVisible
          ? "grid-rows-[44px_auto_minmax(0,1fr)]"
          : "grid-rows-[44px_minmax(0,1fr)]",
        lightChrome ? "text-[#202020]" : "text-cream",
      )}
      style={{ backgroundColor: browserChromeBackground }}
      data-browser-theme={browserTheme}
      data-browser-workspace-tab={tab.id}
    >
      <div
        className={cn(
          "relative z-10 flex items-center gap-2 border-b px-4",
          isNativeMobileBuild && "gap-1 px-1",
          lightChrome ? "border-black/[0.08]" : "border-white/[0.055]",
        )}
        style={{ backgroundColor: browserChromeBackground }}
        data-browser-toolbar
      >
        <div className="flex shrink-0 items-center gap-1">
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
                useBrowserRuntimeStore.getState().setLoading(tab.id, true);
                void invoke("browser_webview_reload", {
                  request: { id: browserRuntimeId(tab) },
                }).catch((error: unknown) => setBrowserError(tab.id, error));
              }
            }}
          >
            <RotateCw size={20} strokeWidth={1.7} />
          </button>
        </div>

        {state.agentOwned ? (
          <span
            className={cn(
              "shrink-0 rounded-md border px-2 py-1 text-[10px] font-medium",
              lightChrome
                ? "border-black/10 bg-black/[0.035] text-black/60"
                : "border-white/[0.08] bg-white/[0.045] text-cream-muted",
            )}
            title="This browser tab is scoped to Misty's current work"
          >
            Misty
          </span>
        ) : null}

        <BrowserOmnibox
          currentUrl={state.url}
          historyEntries={history.entries}
          lightChrome={lightChrome}
          tab={tab}
          onNavigate={navigateActiveTab}
        />

        <div className="flex shrink-0 items-center gap-1">
          {!isNativeMobileBuild ? (
            <>
              <button
                type="button"
                className={cn(
                  iconButtonClass,
                  annotationsActive &&
                    (lightChrome
                      ? "bg-black/[0.06] text-[#202020]"
                      : "bg-white/[0.06] text-[#e9e9e9]"),
                )}
                aria-label={annotationsActive ? "Exit annotation mode" : "Annotate page"}
                aria-pressed={annotationsActive}
                title={annotationsActive ? "Exit annotation mode" : "Annotate page"}
                onClick={() => setAnnotationsActive((active) => !active)}
              >
                <Pencil size={20} strokeWidth={1.7} />
              </button>
              <BrowserViewportMenu
                value={viewport}
                onChange={setViewport}
                iconButtonClass={iconButtonClass}
                lightChrome={lightChrome}
                suspensionReason={viewportMenuSuspensionReason}
              />
            </>
          ) : null}
          <Popover open={agentMenuOverlay.open} onOpenChange={agentMenuOverlay.onOpenChange}>
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
            <PopoverContent
              align="end"
              sideOffset={8}
              className="w-72 p-3 data-[state=closed]:animate-none data-[state=open]:animate-none"
            >
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
              <div className="mt-3 border-t border-charcoal-border pt-3">
                <p className="m-0 text-xs font-medium">Misty page context</p>
                <p className="mb-2 mt-1 text-[11px] text-cream-muted">
                  A one-time inspection captures bounded page text. The temporary read grant is
                  revoked immediately after capture.
                </p>
                <button
                  type="button"
                  className="w-full rounded-md border border-charcoal-border bg-charcoal-card px-3 py-2 text-xs hover:bg-charcoal-hover disabled:opacity-50"
                  disabled={mistyPageLoading || !nativeRuntime}
                  onClick={() => void attachPageToMisty()}
                >
                  {mistyPageLoading
                    ? "Reading page…"
                    : mistyPage
                      ? "Refresh page context"
                      : "Allow one-time page read"}
                </button>
                {mistyPage ? (
                  <p className="mb-0 mt-2 text-[10px] text-cream-muted">
                    Attached: {mistyPage.title}
                    {mistyPage.truncated ? " (bounded extract)" : ""}
                  </p>
                ) : null}
              </div>
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

      {runtimeError ? (
        <SystemErrorActivity
          error={runtimeError}
          scope={`browser:${tab.id}`}
          title="Browser needs attention"
          target={{ kind: "route", href: "/browser" }}
        />
      ) : null}

      {downloadNotice || compatibilityIssue ? (
        <div
          className={cn(
            "border-b px-4 py-1.5 text-xs",
            compatibilityIssue
              ? "border-amber-400/20 bg-amber-400/10 text-cream"
              : "border-emerald-500/20 bg-emerald-500/10 text-cream",
          )}
          role="status"
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">
              {downloadNotice ?? "This site rejected Misty’s embedded browser verification."}
            </span>
            {compatibilityIssue ? (
              <button
                type="button"
                className="shrink-0 rounded-md bg-white/10 px-2 py-1 font-medium hover:bg-white/15"
                onClick={() => {
                  void openSystemExternalLink(compatibilityIssue.url).catch((error: unknown) =>
                    setBrowserError(tab.id, error),
                  );
                }}
              >
                Open in browser
              </button>
            ) : null}
            <button
              type="button"
              className="grid size-5 shrink-0 place-items-center rounded hover:bg-white/10"
              aria-label="Dismiss browser message"
              onClick={() => {
                useBrowserRuntimeStore.getState().setError(tab.id, null);
                useBrowserRuntimeStore.getState().setNotice(tab.id, null);
                useBrowserRuntimeStore.getState().setCompatibilityIssue(tab.id, null);
              }}
            >
              <X size={13} />
            </button>
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          "flex min-h-0 min-w-0 justify-center overflow-hidden",
          viewport === "responsive" ? "p-0" : "p-3",
          viewport === "responsive" ? undefined : lightChrome ? "bg-[#e8e8e8]" : "bg-[#101010]",
        )}
        style={viewport === "responsive" ? { backgroundColor: browserChromeBackground } : undefined}
        data-browser-page-stage
      >
        <div
          ref={pageHostRef}
          className={cn(
            "relative h-full min-h-0 min-w-0 overflow-hidden transition-[width,border-radius,box-shadow] duration-200",
            viewport === "responsive"
              ? "rounded-none shadow-none"
              : "rounded-xl shadow-2xl ring-1 ring-black/15",
            annotationsActive && "bg-transparent",
          )}
          style={{
            width: viewportWidth ? `min(100%, ${viewportWidth}px)` : "100%",
            backgroundColor: annotationsActive ? "transparent" : browserChromeBackground,
          }}
          data-browser-page-host
          data-browser-viewport={viewport}
        >
          {isOffline ? (
            <BrowserOfflinePage
              url={state.url}
              onRetry={handleRetry}
              onGoHome={handleGoHome}
              lightChrome={lightChrome}
            />
          ) : !nativeRuntime && state.url !== blankBrowserUrl ? (
            <BrowserNativeRuntimeRequired
              url={state.url}
              onOpenExternal={() =>
                void openSystemExternalLink(state.url).catch((error: unknown) =>
                  setBrowserError(tab.id, error),
                )
              }
            />
          ) : null}
          <BrowserAnnotationLayer
            active={annotationsActive}
            lightChrome={lightChrome}
            onClose={() => setAnnotationsActive(false)}
          />
        </div>
      </div>
    </section>
  );
}

function BrowserNativeRuntimeRequired(props: { url: string; onOpenExternal: () => void }) {
  return (
    <div
      className="absolute inset-0 grid place-items-center overflow-y-auto bg-charcoal-bg p-6"
      data-testid="browser-native-runtime-required"
    >
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <div className="mb-5 grid size-12 place-items-center rounded-xl bg-charcoal-card text-sage-fg">
          <ShieldCheck className="size-6" aria-hidden="true" />
        </div>
        <h1 className="text-base font-semibold tracking-[-0.02em] text-cream-bright">
          Open this page in the Misty desktop app
        </h1>
        <p className="mt-2 max-w-sm text-sm leading-5 text-cream-muted">
          Misty runs websites in a separate native browser view. The web companion does not use
          embedded page frames.
        </p>
        <p className="mt-4 max-w-full truncate rounded-md bg-charcoal-card px-3 py-2 font-mono text-xs text-cream-muted">
          {props.url}
        </p>
        <button
          type="button"
          className="mt-5 inline-flex min-h-9 items-center gap-2 rounded-md bg-charcoal-active px-3 text-sm font-medium text-cream-bright transition-colors hover:bg-charcoal-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream-muted"
          onClick={props.onOpenExternal}
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          Open in default browser
        </button>
      </div>
    </div>
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
