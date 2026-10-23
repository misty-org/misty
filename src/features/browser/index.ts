export { useBrowserOverlayControl } from "./workspace/useBrowserOverlayControl";
export { browserRuntimeId, requestBrowserWebviewLayout } from "@/features/webviews/browserRuntime";

export { useBrowserDownloadsStore } from "./library/downloadsStore";
export { useBrowserMediaStore } from "./library/mediaStore";
export { browserLibrary, browserPageTools } from "./library/native";
export type { BrowserDownloadEntry, BrowserHistoryVisit } from "./library/native";
export { ClearBrowsingDataDialog } from "./workspace/BrowserClearDataDialog";
// The agent browser's small copy of the browser (agents/agentBrowser): the same controls, tab
// rows and page measurement.
export { BrowserNavigationButtons } from "./workspace/BrowserNavigationButtons";
export { hostAddress } from "./workspace/BrowserOmniboxView";
export { visibleBrowserBounds } from "./workspace/browserHostBounds";
export { usePresentedPageHost } from "./workspace/BrowserPageStage";
export { browserTabRowStyles } from "./workspace/browserTabRowStyles";
export { browserToolbarStyles } from "./workspace/browserToolbarStyles";
