// What the rest of the app uses of the web page runtime: the pages agents open, shown beside
// their chats, and what a person can do about the data those pages keep.
export { browserLibrary } from "./library/native";
export { BrowserNavigationButtons } from "./webviews/BrowserNavigationButtons";
export { visibleBrowserBounds } from "./webviews/browserHostBounds";
export { usePresentedPageHost } from "./webviews/presentedPageHost";
export { BrowserRuntimeBridge } from "./webviews/BrowserRuntimeBridge";
export { SiteIcon } from "./webviews/SiteIcon";
export {
  closeOrphanAgentPages,
  closeOrphanBrowserPages,
  hideAdoptedBrowserPage,
  requestBrowserWebviewLayoutByRuntimeId,
  scheduleStrayPageSweep,
  showAdoptedBrowserPage,
} from "./webviews/browserRuntime";
export { PrivacySection } from "./settings/PrivacySection";
