import { ExtensionsToolbar } from "@/features/extensions/ExtensionsToolbar";
import { supportsSitePermissions } from "@/features/browser-workspace/sitePermissions";
import {
  browserInternalPage,
  dockLeaves,
  parseBrowserViewState,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/workspace";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { cn, DropdownMenuCheckboxItem, Portal } from "@/shared/ui";
import { Pencil, VenetianMask } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useBrowserToolbarSlot } from "./browserToolbarSlot";
import { BrowserAgentAccessMenu } from "./BrowserAgentAccessMenu";
import { BrowserBookmarkDialog } from "./BrowserBookmarkDialog";
import { BrowserClearDataDialog } from "./BrowserClearDataDialog";
import { BrowserClipboardButton } from "./BrowserClipboardButton";
import { BrowserDownloadsButton } from "./BrowserDownloadsButton";
import { BrowserFindBar } from "./BrowserFindBar";
import { BrowserHelpDialog } from "./BrowserHelpDialog";
import { BrowserMenu } from "./BrowserMenu";
import { BrowserMenuLeadRows } from "./BrowserMenuLeadRows";
import { BrowserNavigationButtons } from "./BrowserNavigationButtons";
import { useTabAway } from "@/features/agents";
import { BrowserOmnibox } from "./BrowserOmnibox";
import { BrowserLibraryMenus } from "./BrowserLibraryMenus";
import { BrowserPaneLayoutMenu } from "./BrowserPaneLayoutMenu";
import { useBrowserChromeSlot } from "./browserChromeSlot";
import { BrowserQrCodeDialog } from "./BrowserQrCodeDialog";
import {
  browserRuntimeCreated,
  browserRuntimeId,
  setBrowserTabShowsInternalPage,
  setBrowserWebviewsSuspended,
  useBrowserRuntimeStore,
  type BrowserMistyPage,
} from "./browserRuntime";
import { inspectBrowserPage } from "./browserPageInspection";
import { setBrowserError } from "./browserErrors";
import { BrowserNotices } from "./BrowserNotices";
import { BrowserPageStage } from "./BrowserPageStage";
import { BrowserSiteInfo } from "./BrowserSiteInfo";
import { BrowserToolbar } from "./BrowserToolbar";
import { usePaneToolbarHost } from "./paneToolbarHost";
import { browserToolbarStyles } from "./browserToolbarStyles";
import { BrowserViewportMenu, useBrowserViewport } from "./BrowserViewportMenu";
import { useBrowserMistyAiAdapter } from "./useBrowserMistyAiAdapter";
import { useBrowserMenuCommands } from "./useBrowserMenuCommands";
import { useBrowserNavigation } from "./useBrowserNavigation";
import { useBrowserTheme } from "./useBrowserTheme";
import { useBrowserOnlineStatus } from "./useBrowserOnlineStatus";
import { useBrowserPageCommands } from "./useBrowserPageCommands";
import { useBrowserPagePreview } from "./useBrowserPagePreview";
import { useBrowserReadingTools } from "./useBrowserReadingTools";
import { useHiddenToolbarButtons } from "@/features/settings/browserToolbarButtons";
import { profileDataIdForView } from "@/features/workspace/browserProfiles";
import { useBrowserWebviewGeometry } from "./useBrowserWebviewGeometry";
export function BrowserWorkspace(props: { tab?: WorkspaceView }) {
  const fallbackTab = useWorkspaceStore((store) => {
    const panes = dockLeaves(store.layout.root);
    const pane = panes.find((candidate) => candidate.id === store.layout.focusedPaneId) ?? panes[0];
    const candidate = pane?.views.find((item) => item.id === pane.activeViewId);
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
function ActiveBrowserWorkspace({ tab }: { tab: WorkspaceView }) {
  const active = useWorkspaceStore((state) =>
    dockLeaves(state.layout.root).some((pane) => pane.activeViewId === tab.id),
  );
  const nativeRuntime = hasTauriInternals();
  const state = parseBrowserViewState(tab.state);
  const pageHostRef = useRef<HTMLDivElement | null>(null);
  const browserTheme = useBrowserTheme(tab.id, nativeRuntime);
  const [annotationsActive, setAnnotationsActive] = useState(false);
  const [addressFocusRequest, setAddressFocusRequest] = useState(0);
  const { viewport, setViewport, sizes, setSize, size: viewportSize } = useBrowserViewport();
  const [mistyPage, setMistyPage] = useState<BrowserMistyPage | null>(null);
  const [mistyPageLoading, setMistyPageLoading] = useState(false);
  const storedHistory = useBrowserRuntimeStore((runtime) => runtime.histories[tab.id]);
  const history = storedHistory ?? {
    entries: [state.url],
    index: 0,
  };
  const runtimeError = useBrowserRuntimeStore((runtime) => runtime.errors[tab.id] ?? null);
  const pageLoading = useBrowserRuntimeStore((runtime) => runtime.loading[tab.id] ?? false);
  const internalPage = browserInternalPage(state.url);
  // Views in a device profile use that profile's website data and history.
  const profileId = useWorkspaceStore(
    (store) => state.profileId ?? profileDataIdForView(store, tab.id),
  );
  useBrowserPagePreview(tab, pageHostRef, nativeRuntime && active && !pageLoading && !runtimeError);
  const { isOffline, handleRetry, handleGoHome } = useBrowserOnlineStatus(
    tab,
    state.url,
    nativeRuntime,
  );
  const browserChromeBackground = "var(--workspace-tab-surface)";
  const annotationSuspensionReason = `browser-annotations:${browserRuntimeId(tab)}`;
  const away = useTabAway(browserRuntimeId(tab));
  useBrowserMistyAiAdapter(tab, mistyPage, nativeRuntime);
  const { reader, translate } = useBrowserReadingTools({
    tab,
    url: state.url,
    available:
      nativeRuntime &&
      !internalPage &&
      /^https?:\/\//i.test(state.url) &&
      browserRuntimeCreated(tab),
  });
  useBrowserWebviewGeometry({
    hostRef: pageHostRef,
    nativeRuntime,
    nativeLiveResize: viewport === "responsive",
    tab,
    url: state.url,
    theme: browserTheme,
    // Misty's own pages, reader mode and the offline page replace the native page.
    offline: isOffline || internalPage !== null || reader.article !== null,
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
    setBrowserWebviewsSuspended(annotationsActive, annotationSuspensionReason);
    return () => setBrowserWebviewsSuspended(false, annotationSuspensionReason);
  }, [annotationSuspensionReason, annotationsActive]);
  const { navigateActiveTab, travel, reload, focused } = useBrowserNavigation({
    tab,
    state,
    nativeRuntime,
    internalPage,
    onEditAddress: () => setAddressFocusRequest((request) => request + 1),
  });
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
  const page = useBrowserPageCommands({
    tab,
    state,
    nativeRuntime,
    focused,
    navigate: navigateActiveTab,
  });
  page.commands.readerMode = reader.toggle;
  page.commands.translate = translate;
  useBrowserMenuCommands({
    tab,
    commands: page.commands,
    travel,
    reload,
    annotate: () => setAnnotationsActive(true),
  });
  const showStop = pageLoading && !internalPage && Boolean(page.commands.stop);
  const hiddenButtons = useHiddenToolbarButtons();
  const siteInfo =
    !hiddenButtons.has("site-info") && supportsSitePermissions() && /^https?:/.test(state.url) ? (
      <BrowserSiteInfo id={browserRuntimeId(tab)} url={state.url} active={active} />
    ) : null;
  const paneLayout = <BrowserPaneLayoutMenu tabId={tab.id} />;
  const chrome = useBrowserChromeSlot();
  const { nav: navSlot, top: topSlot } = useBrowserToolbarSlot();
  const paneFocused = useWorkspaceStore((store) =>
    dockLeaves(store.layout.root).some(
      (pane) => pane.id === store.layout.focusedPaneId && pane.activeViewId === tab.id,
    ),
  );
  // With vertical tabs the focused pane's toolbar lives in the sidebar; no pane keeps a row.
  const sidebar = Boolean(topSlot);
  // A pane with horizontal tabs owns the one toolbar row; this page's toolbar is portaled
  // into it while the page is the pane's active one.
  const paneToolbarHost = usePaneToolbarHost();
  const hoisted = !sidebar && paneToolbarHost !== null;
  const claimsNav = paneFocused && sidebar && Boolean(navSlot);
  useEffect(
    () => (claimsNav ? useBrowserToolbarSlot.getState().claimNav() : undefined),
    [claimsNav],
  );
  const navButtons = (
    <BrowserNavigationButtons
      canGoBack={history.index > 0}
      canGoForward={history.index < history.entries.length - 1}
      showStop={showStop}
      reloadDisabled={Boolean(internalPage)}
      onTravel={travel}
      onStop={page.commands.stop}
      onReload={reload}
    />
  );
  const badges = (
    <>
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
    </>
  );
  const moreAnchor = useRef<HTMLDivElement | null>(null);
  const browserMenu = (sidebarMenu: boolean) => (
    <BrowserMenu
      toolsIcon={sidebarMenu}
      library={sidebarMenu ? undefined : <BrowserLibraryMenus />}
      account={sidebarMenu ? undefined : chrome?.accountItems}
      lead={
        sidebarMenu ? (
          <BrowserMenuLeadRows
            tabId={tab.id}
            runtimeId={browserRuntimeId(tab)}
            url={state.url}
            agentOwned={Boolean(state.agentOwned)}
            onBookmark={page.commands.bookmark}
            anchor={() => moreAnchor.current}
          />
        ) : undefined
      }
      nativeRuntime={nativeRuntime}
      tab={tab}
      url={state.url}
      commands={page.commands}
      tools={
        <>
          <DropdownMenuCheckboxItem
            checked={annotationsActive}
            onCheckedChange={(checked) => setAnnotationsActive(checked === true)}
          >
            <Pencil />
            <span className="min-w-0 flex-1 truncate">Annotate page</span>
          </DropdownMenuCheckboxItem>
          <BrowserViewportMenu
            value={viewport}
            onChange={setViewport}
            sizes={sizes}
            onSizeChange={setSize}
          />
          <BrowserAgentAccessMenu
            nativeRuntime={nativeRuntime}
            mistyPage={mistyPage}
            mistyPageLoading={mistyPageLoading}
            onAttachPage={() => void attachPageToMisty()}
          />
          <BrowserClipboardButton />
        </>
      }
    />
  );
  const sidebarTrailing = (
    <>
      {hiddenButtons.has("extensions") ? null : (
        <ExtensionsToolbar tabId={browserRuntimeId(tab)} agentOwned={state.agentOwned} pinnedOnly />
      )}
      {siteInfo}
      {browserMenu(true)}
    </>
  );
  const omnibox = (
    <BrowserOmnibox
      focusRequest={addressFocusRequest}
      currentUrl={state.url}
      onNavigate={navigateActiveTab}
      hostOnly={sidebar}
      leading={sidebar ? undefined : siteInfo}
      trailing={sidebar ? sidebarTrailing : undefined}
    />
  );
  const toolButtons = (
    <>
      {paneLayout}
      {hiddenButtons.has("extensions") ? null : (
        <ExtensionsToolbar tabId={browserRuntimeId(tab)} agentOwned={state.agentOwned} />
      )}
      {hiddenButtons.has("downloads") ? null : (
        <BrowserDownloadsButton
          suspensionReason={`browser-downloads:${browserRuntimeId(tab)}`}
          onShowAll={() => page.commands.openPage("downloads")}
        />
      )}
      {chrome?.sync}
      {chrome?.profile}
      {browserMenu(false)}
    </>
  );
  // Vertical tabs: back/forward/reload go beside the sidebar toggle, and the address field,
  // pinned extensions and a ⋯ menu (bookmark, Misty, extensions, then the browser menu) fill
  // the sidebar's top slot.
  const toolbar = (
    <BrowserToolbar nav={navButtons} badges={badges} address={omnibox} tools={toolButtons} />
  );
  const sidebarTop = (
    <div className={browserToolbarStyles.sidebarTop} data-browser-toolbar data-sidebar>
      {state.private || state.agentOwned ? (
        <div className="flex items-center gap-1" data-misty-window-drag-block="true">
          {badges}
        </div>
      ) : null}
      <div
        ref={moreAnchor}
        className="flex items-center gap-0.5"
        data-misty-window-drag-block="true"
      >
        {omnibox}
      </div>
    </div>
  );
  return (
    <section
      className={cn("grid h-full min-h-0 overflow-hidden", "text-cream")}
      style={{
        gridTemplateRows: `${sidebar || hoisted ? 0 : browserToolbarStyles.rowHeight}px minmax(0,1fr) auto`,
        backgroundColor: browserChromeBackground,
      }}
      data-browser-theme={browserTheme}
      data-browser-workspace-tab={tab.id}
    >
      {sidebar ? (
        <>
          <div aria-hidden="true" />
          {paneFocused && navSlot ? (
            <Portal container={navSlot}>
              <div
                className={cn(browserToolbarStyles.group)}
                data-browser-toolbar
                data-sidebar
                data-misty-window-drag-block="true"
              >
                {navButtons}
                {paneLayout}
              </div>
            </Portal>
          ) : null}
          {paneFocused && topSlot ? <Portal container={topSlot}>{sidebarTop}</Portal> : null}
        </>
      ) : hoisted ? (
        <>
          <div aria-hidden="true" />
          {active ? <Portal container={paneToolbarHost}>{toolbar}</Portal> : null}
        </>
      ) : (
        toolbar
      )}
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
        profileId={profileId}
        suspensionReason={`browser-clear-data:${browserRuntimeId(tab)}`}
      />
      <BrowserNotices tab={tab} active={active} />

      <BrowserPageStage
        tab={tab}
        url={state.url}
        viewport={viewport}
        viewportSize={viewportSize}
        chromeBackground={browserChromeBackground}
        pageHostRef={pageHostRef}
        annotationsActive={annotationsActive}
        onCloseAnnotations={() => setAnnotationsActive(false)}
        internalPage={internalPage}
        profileId={profileId}
        isOffline={isOffline}
        away={Boolean(away)}
        nativeRuntime={nativeRuntime}
        commands={page.commands}
        navigate={navigateActiveTab}
        onRetry={handleRetry}
        onGoHome={handleGoHome}
        reader={reader}
      />
      <BrowserFindBar
        runtimeId={browserRuntimeId(tab)}
        request={page.findRequest}
        pageKey={state.url}
      />
    </section>
  );
}
