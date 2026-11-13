// The native browser runtime: the agents' pages beside their chats, placed, shown and hidden
// through per-page queues. State lives in browserRuntimeSets.ts; the work is split by stage.
export { scheduleStrayPageSweep } from "./browserRuntimeVisibility";
export { requestBrowserWebviewLayoutByRuntimeId } from "./browserRuntimeSync";
export { hideAdoptedBrowserPage, showAdoptedBrowserPage } from "./browserAdoptedPages";
export { closeOrphanAgentPages, closeOrphanBrowserPages } from "./browserRuntimeClose";
