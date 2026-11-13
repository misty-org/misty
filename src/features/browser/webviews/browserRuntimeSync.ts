import { browserRuntimeResumeEvent, lastBounds } from "@/features/app-windows";

/** Asks the page's geometry owner to place it again, even where its bounds did not change. */
export function requestBrowserWebviewLayoutByRuntimeId(runtimeId: string): void {
  lastBounds.delete(runtimeId);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(browserRuntimeResumeEvent));
  }
}
