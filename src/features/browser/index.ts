export { useBrowserOverlayControl } from "./pages/useBrowserOverlayControl";
export { browserRuntimeId, requestBrowserWebviewLayout } from "./webviews/browserRuntime";

export { useBrowserDownloadsStore } from "./library/downloadsStore";
export { useBrowserMediaStore } from "./library/mediaStore";
export { browserLibrary, browserPageTools } from "./library/native";
export type { BrowserDownloadEntry, BrowserHistoryVisit } from "./library/native";
export { ClearBrowsingDataDialog } from "./pages/BrowserClearDataDialog";
// The agent browser's small copy of the browser (agents/agentBrowser): the same controls, tab
// rows and page measurement.
export { BrowserNavigationButtons } from "./pages/BrowserNavigationButtons";
export { hostAddress } from "./pages/BrowserOmniboxView";
export { visibleBrowserBounds } from "./pages/browserHostBounds";
export { usePresentedPageHost } from "./pages/BrowserPageStage";
export { browserTabRowStyles } from "./pages/browserTabRowStyles";
// Public surface used by other features (generated from their imports).
export { AddressEditor } from "./autofill/AddressEditor";
export { AutofillChooser } from "./autofill/AutofillChooser";
export { CardEditor } from "./autofill/CardEditor";
export { autofillApi, type SavedAddress, type SavedCard } from "./autofill/api";
export { formatCardExpiry } from "./autofill/cardInput";
export { addFavorite, isFavorite, removeFavorite, useFavorites } from "./bookmarks/favorites";
export { bookmarkUrl, bookmarks, saveBookmark } from "./bookmarks/library";

export { type Bookmark } from "./bookmarks/tree";
export { ExtensionInstallRequest } from "./extensions/ExtensionInstallRequest";
export { ExtensionPermissionRequest } from "./extensions/ExtensionPermissionRequest";
export { ExtensionsSettings } from "./extensions/ExtensionsSettings";
export { ExtensionsSetupStep } from "./extensions/ExtensionsSetupStep";
export { useExtensionsStore } from "./extensions/store";
export { useExtensionsRuntime } from "./extensions/useExtensionsRuntime";

export { BrowserImportFlow } from "./import";
export { ProfileImportRequest } from "./import/ProfileImportRequest";
export { type BrowserMediaInfo } from "./library";
export { PageStateBridge } from "./page-state/PageStateBridge";
export { configureExcludedSites } from "./page-state/settings";
export {
  BrowserAgentsButton,
  BrowserDownloadsButton,
  BrowserOmnibox,
  BrowserPaneLayoutMenu,
  BrowserViewAudioButton,
  BrowserWorkspace,
  SidebarToolsPinMenu,
  browserToolbarStyles,
  useBrowserToolbarSlot,
  useSidebarTools,
  type SidebarToolId,
} from "./pages";
export { PasswordEditor } from "./passwords/PasswordEditor";
export { passwordsApi, siteLabel, type SavedLogin } from "./passwords/api";
export { loginsToCsv, parseLoginsCsv, type CsvLogin } from "./passwords/csv";
export { BrowserSearchDialog } from "./search/BrowserSearchDialog";
export { useBrowserSearchStore } from "./search/search";

export { configureExternalLinks } from "./urls/externalLinkSettings";
export { openExternalLink } from "./urls/externalLinks";
export { BrowserRuntimeBridge } from "./webviews/BrowserRuntimeBridge";
export { SiteIcon } from "./webviews/SiteIcon";
export {
  browserOverlayReady,
  browserRuntimeCreated,
  browserRuntimeIdForTabId,
  browserRuntimeResumeEvent,
  browserScopeId,
  browserTabIdForRuntime,
  browserTabShowsInternalPage,
  closeOrphanBrowserPages,
  hideAdoptedBrowserPage,
  isBrowserLayoutMoving,
  pagePreviewGeneration,
  requestBrowserWebviewLayoutByRuntimeId,
  savePagePreview,
  scheduleStrayPageSweep,
  setBrowserDownloadDirectory,
  setBrowserDownloadPrompt,
  setBrowserPointerTrackingEnabled,
  setBrowserRuntimeKeepLive,
  setBrowserStatusBubbleEnabled,
  setBrowserWebviewsSuspended,
  showAdoptedBrowserPage,
  useBrowserRuntimeStore,
  windowChromeChangedEvent,
} from "./webviews/browserRuntime";
export { beginBrowserSlide, endBrowserSlide } from "./webviews/browserSlide";

export { configureHiddenTabSleep } from "./webviews/hiddenTabSleep";

export { configureBrowserMouseGestures } from "./webviews/mouseGestures";
export { pictureInPictureSupported } from "./webviews/pictureInPictureSettings";
export { providerFromRoute } from "./webviews/providers";
export { configureBrowserSiteStyles } from "./webviews/siteStyles";
export { configureBrowserSiteZoom } from "./webviews/siteZoom";
export { configureTabHistoryBudget } from "./webviews/tabHistory";
export { useBrowserPaneDim } from "./webviews/useBrowserPaneDim";
export { websiteIntegrations } from "./webviews/websiteIntegrations";

// Public surface used by other features (generated from their imports).
export {
  setBarsAutoHide,
  setSpaceBarAutoHide,
  useBarsAutoHide,
} from "./bars-auto-hide/barsAutoHide";

// Public surface used by other features (generated from their imports).
export { AutofillSettings } from "./autofill/AutofillSettings";
export { PasswordsSettings } from "./passwords/PasswordsSettings";
export { BrowserPermissionSettings } from "./settings/BrowserPermissionSettings";
export { BrowserLinksSettings, DownloadsSettings } from "./settings/BrowserSection";
export { PrivacySection } from "./settings/PrivacySection";

// Public surface used by other features (generated from their imports).
export { inspectBrowserPage } from "./pages/browserPageInspection";
export { browserContentHash, type BrowserMistyPage } from "./webviews/browserRuntime";
export { browserAgents, type BrowserAgents } from "./pages/AgentSeams";
export type { BrowserAskSnapshot } from "./webviews/browserAsk";
export { liveSubtitlesMenuItem } from "./pages/VoiceSeams";
