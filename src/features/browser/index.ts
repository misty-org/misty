export { browserLibrary } from "./library/native";
export { BrowserNavigationButtons } from "./webviews/BrowserNavigationButtons";
export { visibleBrowserBounds } from "./webviews/browser_host_bounds";
export { usePresentedPageHost } from "./webviews/presented_page_host";
export { BrowserRuntimeBridge } from "./webviews/BrowserRuntimeBridge";
export { SiteIcon } from "./webviews/SiteIcon";
export {
  closeOrphanAgentPages,
  hideAdoptedBrowserPage,
  requestBrowserWebviewLayoutByRuntimeId,
  showAdoptedBrowserPage,
} from "./webviews/browser_runtime";
export { PrivacySection } from "./settings/PrivacySection";
export { BrowserSearchRows } from "./settings/BrowserSearchRows";
export { configureWebSearch } from "./tabs/web_search";
export { WebTabPage } from "./tabs/WebTabPage";
export { pageLabel } from "./tabs/web_address";
export { useWebTabs, webTabOfView } from "./tabs/web_tab_store";
export {
  newWebTabRoute,
  openWebTabs,
  wakeWebTab,
  webTabIdOfRoute,
  webTabOfScope,
  webTabRoutePrefix,
  webTabRouteFor,
} from "./tabs/web_tabs";
export type { WebTranslator } from "./tabs/WebTranslatePanel";
export { prewarmTurn, shownPageBox, whenPageHostShown } from "./tabs/page_prewarm";
export {
  actOnPageMedia,
  closePageMedia,
  followPageMedia,
  pageMediaKey,
  setPageMuted,
  usePageMedia,
} from "./media/page_media";
export type { PageMedia, PageMediaAction, PageMediaPage, PlayingPage } from "./media/page_media";
