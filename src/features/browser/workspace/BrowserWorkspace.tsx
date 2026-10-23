import { ExtensionsToolbar } from "@/features/extensions/ExtensionsToolbar";
import { supportsSitePermissions } from "@/features/browser-sync/sitePermissions";
import {
  browserInternalPage,
  dockLeaves,
  parseBrowserViewState,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/workspace";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { cn } from "@/shared/ui";
import { useEffect, useRef, useState } from "react";
import { BrowserDownloadsButton } from "./BrowserDownloadsButton";
import { BrowserFindBar } from "./BrowserFindBar";
import { BrowserMenuTools } from "./BrowserMenuTools";
import { BrowserAgentsButton, BrowserMistyButton } from "./BrowserMistyPanel";
import { BrowserNavigationButtons } from "./BrowserNavigationButtons";
import { BrowserOmnibox } from "./BrowserOmnibox";
import { BrowserPaneLayoutMenu } from "./BrowserPaneLayoutMenu";
import { useBrowserChromeSlot } from "./browserChromeSlot";
import {
  browserRuntimeCreated,
  browserRuntimeId,
  setBrowserTabShowsInternalPage,
  setBrowserWebviewsSuspended,
  useBrowserRuntimeStore,
} from "@/features/webviews/browserRuntime";
import { BrowserNotices } from "./BrowserNotices";
import { BrowserPageDialogs } from "./BrowserPageDialogs";
import { BrowserPageStage } from "./BrowserPageStage";
import { BrowserSidebarChrome } from "./BrowserSidebarChrome";
import { BrowserTabBadges } from "./BrowserTabBadges";
import { BrowserSiteInfo } from "./BrowserSiteInfo";
import { BrowserToolbar } from "./BrowserToolbar";
import { BrowserWorkspaceMenu } from "./BrowserWorkspaceMenu";
import { browserToolbarStyles } from "./browserToolbarStyles";
import { useBrowserViewport } from "./browserViewport";
import { useBrowserMenuCommands } from "./useBrowserMenuCommands";
import { useBrowserMistyPage } from "./useBrowserMistyPage";
import { useBrowserNavigation } from "./useBrowserNavigation";
import { useBrowserTheme } from "./useBrowserTheme";
import { useBrowserOnlineStatus } from "./useBrowserOnlineStatus";
import { useBrowserPageCommands } from "./useBrowserPageCommands";
import { useBrowserPagePreview } from "./useBrowserPagePreview";
import { useBrowserReadingTools } from "./useBrowserReadingTools";
import { useBrowserToolbarPlacement } from "./useBrowserToolbarPlacement";
import { useBrowserWebviewGeometry } from "./useBrowserWebviewGeometry";
import { isIncognitoWindow } from "@/features/workspace/spaceWindow";
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
  const storedHistory = useBrowserRuntimeStore((runtime) => runtime.histories[tab.id]);
  const history = storedHistory ?? {
    entries: [state.url],
    index: 0,
  };
  const runtimeError = useBrowserRuntimeStore((runtime) => runtime.errors[tab.id] ?? null);
  const pageLoading = useBrowserRuntimeStore((runtime) => runtime.loading[tab.id] ?? false);
  const internalPage = browserInternalPage(state.url);
  const profileId = state.profileId;
  useBrowserPagePreview(tab, pageHostRef, nativeRuntime && active && !pageLoading && !runtimeError);
  const { isOffline, handleRetry, handleGoHome } = useBrowserOnlineStatus(
    tab,
    state.url,
    nativeRuntime,
  );
  const browserChromeBackground = "var(--workspace-tab-surface)";
  const annotationSuspensionReason = `browser-annotations:${browserRuntimeId(tab)}`;
  const { mistyPage, mistyPageLoading, attachPageToMisty } = useBrowserMistyPage(
    tab,
    state.url,
    nativeRuntime,
  );
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
  const siteInfo =
    supportsSitePermissions() && /^https?:/.test(state.url) ? (
      <BrowserSiteInfo id={browserRuntimeId(tab)} url={state.url} active={active} />
    ) : null;
  const paneLayout = <BrowserPaneLayoutMenu tabId={tab.id} />;
  const chrome = useBrowserChromeSlot();
  const { paneFocused, sidebar } = useBrowserToolbarPlacement(tab.id);
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
  const badges = <BrowserTabBadges agentOwned={Boolean(state.agentOwned)} />;
  const moreAnchor = useRef<HTMLDivElement | null>(null);
  const menuTools = (
    <BrowserMenuTools
      annotating={annotationsActive}
      onAnnotatingChange={setAnnotationsActive}
      viewport={viewport}
      onViewportChange={setViewport}
      viewportSizes={sizes}
      onViewportSizeChange={setSize}
      nativeRuntime={nativeRuntime}
      mistyPage={mistyPage}
      mistyPageLoading={mistyPageLoading}
      onAttachPage={() => void attachPageToMisty()}
    />
  );
  const browserMenu = (sidebarMenu: boolean) => (
    <BrowserWorkspaceMenu
      sidebarMenu={sidebarMenu}
      tab={tab}
      url={state.url}
      agentOwned={Boolean(state.agentOwned)}
      nativeRuntime={nativeRuntime}
      commands={page.commands}
      account={chrome?.accountItems}
      anchor={moreAnchor}
      tools={menuTools}
    />
  );
  const sidebarTrailing = (
    <>
      <ExtensionsToolbar tabId={browserRuntimeId(tab)} agentOwned={state.agentOwned} pinnedOnly />
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
  // Tools for this page: extensions (when any are installed), then Agents beside Chat. Pane
  // layout lives in the ⋯ menu here; the sidebar keeps its button beside back and forward.
  const toolButtons = (
    <>
      <ExtensionsToolbar tabId={browserRuntimeId(tab)} agentOwned={state.agentOwned} />
      <BrowserAgentsButton />
      <BrowserMistyButton />
      <BrowserDownloadsButton
        suspensionReason={`browser-downloads:${browserRuntimeId(tab)}`}
        onShowAll={() => page.commands.openPage("downloads")}
      />
      {browserMenu(false)}
    </>
  );
  // In the sidebar back/forward/reload go beside the sidebar toggle, and the address field,
  // pinned extensions and a ⋯ menu (bookmark, extensions, then the browser menu) fill its
  // top slot.
  const toolbar = (
    <BrowserToolbar nav={navButtons} badges={badges} address={omnibox} tools={toolButtons} />
  );
  return (
    <section
      className={cn("grid h-full min-h-0 overflow-hidden", "text-cream")}
      style={{
        gridTemplateRows: `${sidebar ? 0 : browserToolbarStyles.rowHeight}px minmax(0,1fr) auto`,
        backgroundColor: browserChromeBackground,
      }}
      data-browser-theme={browserTheme}
      data-browser-workspace-tab={tab.id}
    >
      {sidebar ? (
        <>
          <div aria-hidden="true" />
          {paneFocused ? (
            <BrowserSidebarChrome
              nav={navButtons}
              badges={state.agentOwned || isIncognitoWindow() ? badges : null}
              address={omnibox}
              addressRef={moreAnchor}
              layout={paneLayout}
            />
          ) : null}
        </>
      ) : (
        toolbar
      )}
      <BrowserPageDialogs tab={tab} url={state.url} profileId={profileId} page={page} />
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
