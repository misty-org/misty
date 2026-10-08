import { SystemErrorActivity } from "@/features/activity";
import { ExtensionsToolbar } from "@/features/extensions/ExtensionsToolbar";
import { useExtensionsStore } from "@/features/extensions/store";
import {
  useAiSurfaceAdapter,
  type AiArtifact,
  type AiSurfaceAdapter,
} from "@/features/ai-surface/AiPaneHost";
import { supportsSitePermissions } from "@/features/browser-workspace/sitePermissions";
import { useShortcutHandler } from "@/features/shortcuts";
import {
  blankBrowserUrl,
  browserInternalPage,
  browserViewTitle,
  createBrowserViewState,
  dockLeaves,
  parseBrowserViewState,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/workspace";
import { openSystemExternalLink } from "@/shared/platform/openExternalLink";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, cn, IconButton, Notification, toolbarIconProps, Skeleton } from "@/shared/ui";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, ArrowRight, Pencil, RotateCw, VenetianMask, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserInternalPage } from "../internal/BrowserInternalPage";
import { normalizeBrowserAddress } from "./browserAddress";
import { BrowserAgentAccessMenu } from "./BrowserAgentAccessMenu";
import { BrowserAnnotationLayer } from "./BrowserAnnotationLayer";
import { BrowserBookmarkDialog } from "./BrowserBookmarkDialog";
import { BrowserBookmarkStar } from "./BrowserBookmarkStar";
import { BrowserClearDataDialog } from "./BrowserClearDataDialog";
import { BrowserClipboardButton } from "./BrowserClipboardButton";
import { BrowserDownloadsButton } from "./BrowserDownloadsButton";
import { BrowserFindBar } from "./BrowserFindBar";
import { BrowserHelpDialog } from "./BrowserHelpDialog";
import { BrowserMenu } from "./BrowserMenu";
import { BrowserNativeRuntimeRequired } from "./BrowserNativeRuntimeRequired";
import { BrowserOfflinePage } from "./BrowserOfflinePage";
import { BrowserOmnibox } from "./BrowserOmnibox";
import { BrowserQrCodeDialog } from "./BrowserQrCodeDialog";
import {
  browserContentHash,
  browserRuntimeCreated,
  browserRuntimeId,
  browserScopeId,
  setBrowserTabShowsInternalPage,
  setBrowserWebviewsSuspended,
  useBrowserRuntimeStore,
  type BrowserMistyPage,
} from "./browserRuntime";
import { inspectBrowserPage } from "./browserPageInspection";
import { BrowserSiteInfo } from "./BrowserSiteInfo";
import { browserThemeFromDocument } from "./browserTheme";
import { browserToolbarStyles } from "./browserToolbarStyles";
import {
  browserViewportFrameStyle,
  BrowserViewportMenu,
  browserViewportStageStyle,
  useBrowserViewport,
} from "./BrowserViewportMenu";
import type { BrowserTheme } from "./types";
import { useBrowserMenuCommands } from "./useBrowserMenuCommands";
import { useBrowserOnlineStatus } from "./useBrowserOnlineStatus";
import { useBrowserOverlayControl } from "./useBrowserOverlayControl";
import { useBrowserPageCommands } from "./useBrowserPageCommands";
import { browserNavigateEvent, type BrowserNavigateDetail } from "./openFromChrome";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { useBrowserPagePreview } from "./useBrowserPagePreview";
import { useBrowserWebviewGeometry } from "./useBrowserWebviewGeometry";
export { normalizeBrowserAddress } from "./browserAddress";
export { browserBoundsAtAppZoom } from "./useBrowserWebviewGeometry";
export function BrowserWorkspace(props: { tab?: WorkspaceView }) {
  const extensionsReady = useExtensionsStore((state) => state.ready);
  const fallbackTab = useWorkspaceStore((store) => {
    const panes = dockLeaves(store.layout.root);
    const pane = panes.find((candidate) => candidate.id === store.layout.focusedPaneId) ?? panes[0];
    const candidate = pane?.views.find((item) => item.id === pane.activeViewId);
    return candidate?.surfaceId === "browser" ? candidate : undefined;
  });
  const tab = props.tab ?? fallbackTab;
  if (hasTauriInternals() && !extensionsReady)
    return (
      <div role="status" aria-label="Browser" aria-busy="true" className="flex h-full flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-charcoal-border px-3">
          <Skeleton className="size-5 rounded" />
          <Skeleton className="size-5 rounded" />
          <Skeleton className="h-6 flex-1 rounded-full" />
        </div>
        <div className="min-h-0 flex-1" />
      </div>
    );
  if (!tab) {
    return (
      <div className="grid h-full place-items-center bg-charcoal-bg text-sm text-cream-muted">
        Open a browser tab to begin.
      </div>
    );
  }
  return <ActiveBrowserWorkspace tab={tab} />;
}
function ActiveBrowserWorkspace({ tab }: { tab: WorkspaceView }) {
  const active = useWorkspaceStore((state) =>
    dockLeaves(state.layout.root).some((pane) => pane.activeViewId === tab.id),
  );
  const nativeRuntime = hasTauriInternals();
  const state = parseBrowserViewState(tab.state);
  const pageHostRef = useRef<HTMLDivElement | null>(null);
  const [browserTheme, setBrowserTheme] = useState<BrowserTheme>(browserThemeFromDocument);
  const [annotationsActive, setAnnotationsActive] = useState(false);
  const [addressFocusRequest, setAddressFocusRequest] = useState(0);
  const { viewport, setViewport, sizes, setSize, size: viewportSize } = useBrowserViewport();
  const [mistyPage, setMistyPage] = useState<BrowserMistyPage | null>(null);
  const [mistyPageLoading, setMistyPageLoading] = useState(false);
  const storedGrants = useBrowserRuntimeStore((runtime) => runtime.grants[tab.id]);
  const storedHistory = useBrowserRuntimeStore((runtime) => runtime.histories[tab.id]);
  const grants = storedGrants ?? [];
  const history = storedHistory ?? {
    entries: [state.url],
    index: 0,
  };
  const runtimeError = useBrowserRuntimeStore((runtime) => runtime.errors[tab.id] ?? null);
  const pageLoading = useBrowserRuntimeStore((runtime) => runtime.loading[tab.id] ?? false);
  const internalPage = browserInternalPage(state.url);
  useBrowserPagePreview(tab, pageHostRef, nativeRuntime && active && !pageLoading && !runtimeError);
  const downloadNotice = useBrowserRuntimeStore((runtime) => runtime.notices[tab.id] ?? null);
  const compatibilityIssue = useBrowserRuntimeStore(
    (runtime) => runtime.compatibilityIssues[tab.id] ?? null,
  );
  const { isOffline, handleRetry, handleGoHome } = useBrowserOnlineStatus(
    tab,
    state.url,
    nativeRuntime,
  );
  const browserChromeBackground = "var(--workspace-tab-surface)";
  const agentAccess = grants.length > 0;
  const annotationSuspensionReason = `browser-annotations:${browserRuntimeId(tab)}`;
  const agentMenuSuspensionReason = `browser-agent-menu:${browserRuntimeId(tab)}`;
  const viewportMenuSuspensionReason = `browser-viewport-menu:${browserRuntimeId(tab)}`;
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
        steps?: Array<{
          action?: string;
          target?: string;
          value?: string;
          effect?: string;
        }>;
      };
      if (operations.tab_scope_id !== scopeId || operations.steps?.length !== 1) return null;
      const step = operations.steps[0];
      if (step.action === "navigate" && typeof step.value === "string") {
        try {
          const url = new URL(step.value);
          return url.protocol === "https:" || url.protocol === "http:"
            ? {
                operation: "browser.navigate",
                input: {
                  url: url.toString(),
                },
              }
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
          input: {
            elementRef: step.target,
            expectDownload: false,
          },
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
              anchors: {
                capture: "visible-page-text",
                truncated: mistyPage.truncated,
              },
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
            const url = String(
              (
                action.input as {
                  url: string;
                }
              ).url,
            );
            useWorkspaceStore.getState().updateBrowserView(tab.id, {
              ...createBrowserViewState(url),
              title: browserViewTitle(url),
            });
            useBrowserRuntimeStore.getState().pushHistory(tab.id, url);
          }
        } finally {
          await invoke("browser_agent_grant_revoke", {
            request: {
              id: browserRuntimeId(tab),
              grantId,
            },
          }).catch(() => undefined);
        }
      },
    };
  }, [mistyPage, nativeRuntime, tab]);
  useAiSurfaceAdapter(aiAdapter);
  useBrowserWebviewGeometry({
    hostRef: pageHostRef,
    nativeRuntime,
    nativeLiveResize: viewport === "responsive",
    tab,
    url: state.url,
    theme: browserTheme,
    // Misty's own pages and the offline page replace the native page.
    offline: isOffline || internalPage !== null,
  });
  useEffect(() => {
    setBrowserTabShowsInternalPage(tab.id, internalPage !== null);
    return () => setBrowserTabShowsInternalPage(tab.id, false);
  }, [internalPage, tab.id]);
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
    void invoke("browser_webview_set_theme", {
      request: {
        theme: browserTheme,
      },
    }).catch((error: unknown) => setBrowserError(tab.id, error));
  }, [browserTheme, nativeRuntime, tab.id]);
  useEffect(() => {
    setBrowserWebviewsSuspended(annotationsActive, annotationSuspensionReason);
    return () => setBrowserWebviewsSuspended(false, annotationSuspensionReason);
  }, [annotationSuspensionReason, annotationsActive]);
  const navigateActiveTab = (rawAddress: string) => {
    useWorkspaceStore.getState().commitPlaceholder(tab.id);
    const url = normalizeBrowserAddress(rawAddress);
    useWorkspaceStore.getState().updateBrowserView(tab.id, {
      ...createBrowserViewState(url),
      title: browserViewTitle(url),
    });
    useBrowserRuntimeStore.getState().pushHistory(tab.id, url);
    // Misty draws its own pages; the hidden native page keeps its place.
    if (browserInternalPage(url)) return;
    useBrowserRuntimeStore.getState().setLoading(tab.id, true);
    if (nativeRuntime && browserRuntimeCreated(tab)) {
      void invoke("browser_webview_navigate", {
        request: {
          id: browserRuntimeId(tab),
          url,
        },
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
    try {
      setMistyPage(await inspectBrowserPage(tab, state.url));
    } catch (error) {
      setBrowserError(tab.id, error);
    } finally {
      setMistyPageLoading(false);
    }
  };
  const travel = (direction: -1 | 1): boolean => {
    const step = useBrowserRuntimeStore.getState().travelHistory(tab.id, direction);
    if (!step) return false;
    const url = step.url;
    const leavingInternalPage = browserInternalPage(state.url) !== null;
    useWorkspaceStore.getState().updateBrowserView(tab.id, {
      url,
      title: browserViewTitle(url),
    });
    if (browserInternalPage(url)) return true;
    useBrowserRuntimeStore.getState().setLoading(tab.id, true);
    if (nativeRuntime && (leavingInternalPage || !step.native)) {
      // The native page's own history never saw the internal page, or this
      // entry came from another device or an earlier session: load it.
      if (browserRuntimeCreated(tab)) {
        void invoke("browser_webview_navigate", {
          request: {
            id: browserRuntimeId(tab),
            url,
          },
        }).catch((error: unknown) => setBrowserError(tab.id, error));
      }
    } else if (nativeRuntime) {
      void invoke(direction < 0 ? "browser_webview_back" : "browser_webview_forward", {
        request: {
          id: browserRuntimeId(tab),
        },
      }).catch((error: unknown) => setBrowserError(tab.id, error));
    }
    return true;
  };
  const focused = () => {
    const workspace = useWorkspaceStore.getState();
    const pane = dockLeaves(workspace.layout.root).find(
      (candidate) => candidate.id === workspace.layout.focusedPaneId,
    );
    return pane?.activeViewId === tab.id;
  };
  useShortcutHandler(
    "browser.edit_address",
    () => setAddressFocusRequest((request) => request + 1),
    focused,
    100,
  );
  useShortcutHandler("navigation.back", () => travel(-1), focused, 100);
  useShortcutHandler("navigation.forward", () => travel(1), focused, 100);
  useShortcutHandler(
    "navigation.refresh",
    () => {
      if (!nativeRuntime) return false;
      useBrowserRuntimeStore.getState().setLoading(tab.id, true);
      void invoke("browser_webview_reload", {
        request: {
          id: browserRuntimeId(tab),
        },
      }).catch((error: unknown) => setBrowserError(tab.id, error));
      return true;
    },
    focused,
    100,
  );
  const page = useBrowserPageCommands({
    tab,
    state,
    nativeRuntime,
    focused,
    navigate: navigateActiveTab,
  });
  // Links opened from workspace chrome (the bookmarks bar) for this tab.
  const navigateFromChrome = useStableCallback(navigateActiveTab);
  useEffect(() => {
    const onNavigate = (event: Event) => {
      const detail = (event as CustomEvent<BrowserNavigateDetail>).detail;
      if (detail?.viewId === tab.id) navigateFromChrome(detail.url);
    };
    window.addEventListener(browserNavigateEvent, onNavigate);
    return () => window.removeEventListener(browserNavigateEvent, onNavigate);
  }, [navigateFromChrome, tab.id]);
  const reload = () => {
    if (!nativeRuntime || internalPage) return;
    useBrowserRuntimeStore.getState().setLoading(tab.id, true);
    void invoke("browser_webview_reload", {
      request: {
        id: browserRuntimeId(tab),
      },
    }).catch((error: unknown) => setBrowserError(tab.id, error));
  };
  useBrowserMenuCommands({
    tab,
    commands: page.commands,
    travel,
    reload,
    annotate: () => setAnnotationsActive(true),
  });
  const showStop = pageLoading && !internalPage && Boolean(page.commands.stop);
  return (
    <section
      className={cn(
        "grid h-full min-h-0 overflow-hidden",
        "grid-rows-[44px_auto_minmax(0,1fr)] text-cream",
      )}
      style={{
        backgroundColor: browserChromeBackground,
      }}
      data-browser-theme={browserTheme}
      data-browser-workspace-tab={tab.id}
    >
      <div
        className={cn(browserToolbarStyles.bar, "border-cream/[0.055]")}
        style={{
          backgroundColor: browserChromeBackground,
        }}
        data-window-toolbar
        data-browser-toolbar
      >
        <div className={browserToolbarStyles.group}>
          <IconButton
            label="Back"
            tooltip={false}
            disabled={history.index === 0}
            onClick={() => travel(-1)}
          >
            <ArrowLeft {...toolbarIconProps} />
          </IconButton>
          <IconButton
            label="Forward"
            tooltip={false}
            disabled={history.index >= history.entries.length - 1}
            onClick={() => travel(1)}
          >
            <ArrowRight {...toolbarIconProps} />
          </IconButton>
          <IconButton
            label={showStop ? "Stop loading" : "Reload"}
            tooltip={false}
            disabled={!showStop && Boolean(internalPage)}
            onClick={showStop ? page.commands.stop : reload}
          >
            {showStop ? (
              <X {...toolbarIconProps} />
            ) : (
              <RotateCw {...browserToolbarStyles.roundIcon} />
            )}
          </IconButton>
        </div>

        {state.private ? (
          <span
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-md border border-cream/[0.08]",
              "bg-cream/[0.045] px-2 py-1 text-[10px] font-medium text-cream-muted",
            )}
            title="Private tab: no history, and cookies and site data are discarded when the last private tab closes"
          >
            <VenetianMask className="size-3" aria-hidden="true" />
            Private
          </span>
        ) : null}
        {state.agentOwned ? (
          <span
            className="shrink-0 rounded-md border border-cream/[0.08] bg-cream/[0.045] px-2 py-1 text-[10px] font-medium text-cream-muted"
            title="This browser tab is scoped to Misty's current work"
          >
            Misty
          </span>
        ) : null}

        {supportsSitePermissions() && /^https?:/.test(state.url) ? (
          <BrowserSiteInfo id={browserRuntimeId(tab)} url={state.url} active={active} />
        ) : null}
        <BrowserOmnibox
          compact={Boolean(state.bookmarkId)}
          pageTitle={tab.title}
          focusRequest={addressFocusRequest}
          currentUrl={state.url}
          historyEntries={history.entries}
          tab={tab}
          onNavigate={navigateActiveTab}
        />
        {page.commands.bookmark ? (
          <BrowserBookmarkStar url={state.url} onBookmark={page.commands.bookmark} />
        ) : null}

        <div className={browserToolbarStyles.group}>
          {
            <>
              <IconButton
                label={annotationsActive ? "Exit annotation mode" : "Annotate page"}
                tooltip={false}
                aria-pressed={annotationsActive}
                onClick={() => setAnnotationsActive((active) => !active)}
              >
                <Pencil {...toolbarIconProps} />
              </IconButton>
              <BrowserViewportMenu
                value={viewport}
                onChange={setViewport}
                sizes={sizes}
                onSizeChange={setSize}
                suspensionReason={viewportMenuSuspensionReason}
              />
            </>
          }
          <BrowserAgentAccessMenu
            overlay={agentMenuOverlay}
            agentAccess={agentAccess}
            nativeRuntime={nativeRuntime}
            mistyPage={mistyPage}
            mistyPageLoading={mistyPageLoading}
            onAttachPage={() => void attachPageToMisty()}
          />
          <ExtensionsToolbar tabId={browserRuntimeId(tab)} agentOwned={state.agentOwned} />
          <BrowserClipboardButton suspensionReason={`browser-clipboard:${browserRuntimeId(tab)}`} />
          {
            <BrowserDownloadsButton
              suspensionReason={`browser-downloads:${browserRuntimeId(tab)}`}
              onShowAll={() => page.commands.openPage("downloads")}
            />
          }
          <BrowserMenu
            nativeRuntime={nativeRuntime}
            tab={tab}
            url={state.url}
            commands={page.commands}
          />
        </div>
      </div>
      <div>
        <BrowserFindBar
          runtimeId={browserRuntimeId(tab)}
          request={page.findRequest}
          pageKey={state.url}
        />
      </div>
      <BrowserBookmarkDialog
        request={page.bookmarkRequest}
        url={state.url}
        title={tab.title}
        suspensionReason={`browser-bookmark:${browserRuntimeId(tab)}`}
      />
      <BrowserQrCodeDialog
        request={page.qrCodeRequest}
        url={state.url}
        suspensionReason={`browser-qr-code:${browserRuntimeId(tab)}`}
      />
      <BrowserHelpDialog
        request={page.helpRequest}
        suspensionReason={`browser-help:${browserRuntimeId(tab)}`}
      />
      <BrowserClearDataDialog
        request={page.clearDataRequest}
        tabId={tab.id}
        profileId={state.profileId}
        suspensionReason={`browser-clear-data:${browserRuntimeId(tab)}`}
      />

      {runtimeError ? (
        <>
          <SystemErrorActivity
            intent="background"
            error={runtimeError}
            scope={`browser:${tab.id}`}
            title="Browser needs attention"
            target={{
              kind: "route",
              href: "/browser",
            }}
          />
          <Notification
            key={runtimeError}
            title="Browser needs attention"
            tone="error"
            active={active}
            onDismiss={() => useBrowserRuntimeStore.getState().setError(tab.id, null)}
          >
            {runtimeError}
          </Notification>
        </>
      ) : null}

      {downloadNotice || compatibilityIssue ? (
        <Notification
          key={downloadNotice ?? compatibilityIssue?.url}
          title="Browser"
          active={active}
          onDismiss={() => {
            useBrowserRuntimeStore.getState().setError(tab.id, null);
            useBrowserRuntimeStore.getState().setNotice(tab.id, null);
            useBrowserRuntimeStore.getState().setCompatibilityIssue(tab.id, null);
          }}
        >
          <p>{downloadNotice ?? "This site rejected Misty’s embedded browser verification."}</p>
          {compatibilityIssue ? (
            <Button
              variant="secondary"
              size="xs"
              className="shrink-0"
              onClick={() => {
                void openSystemExternalLink(compatibilityIssue.url).catch((error: unknown) =>
                  setBrowserError(tab.id, error),
                );
              }}
            >
              Open in browser
            </Button>
          ) : null}
        </Notification>
      ) : null}

      <div
        className={cn(
          "flex min-h-0 min-w-0 items-center justify-center overflow-hidden",
          viewport === "responsive" ? "p-0" : "p-3",
          viewport === "responsive" ? undefined : "bg-charcoal-workspace",
        )}
        style={{
          ...browserViewportStageStyle,
          backgroundColor: viewport === "responsive" ? browserChromeBackground : undefined,
        }}
        data-browser-page-stage
      >
        <div
          ref={pageHostRef}
          className={cn(
            "relative min-h-0 min-w-0 overflow-hidden transition-[border-radius,box-shadow] duration-200",
            viewport === "responsive"
              ? "rounded-none shadow-none"
              : "rounded-xl shadow-2xl ring-1 ring-black/15",
            annotationsActive && "bg-transparent",
          )}
          style={{
            ...browserViewportFrameStyle(viewportSize),
            backgroundColor: annotationsActive
              ? "transparent"
              : internalPage || isOffline
                ? browserChromeBackground
                : `var(--browser-page-background, ${browserChromeBackground})`,
          }}
          data-browser-page-host
          data-browser-viewport={viewport}
        >
          {internalPage ? (
            <BrowserInternalPage
              page={internalPage}
              profileId={state.profileId}
              navigate={navigateActiveTab}
              openInNewView={page.commands.openInNewTab}
              openPage={page.commands.openPage}
              clearBrowsingData={page.commands.clearBrowsingData}
            />
          ) : isOffline ? (
            <BrowserOfflinePage url={state.url} onRetry={handleRetry} onGoHome={handleGoHome} />
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
            onClose={() => setAnnotationsActive(false)}
          />
        </div>
      </div>
    </section>
  );
}
function setBrowserError(tabId: string, error: unknown) {
  useBrowserRuntimeStore
    .getState()
    .setError(tabId, error instanceof Error ? error.message : String(error));
}
