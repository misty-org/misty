import { useEffect } from "react";
import { prepareSparePage } from "../tabs/web_tabs";
import { useBrowserNativeEvents } from "./use_browser_native_events";
import { useBrowserOverlaySuspension, useBrowserPointerSuspension } from "./use_browser_suspension";

export { browserBlockingOverlayOpen } from "@/features/app-windows";

export function BrowserRuntimeBridge() {
  useBrowserPointerSuspension();
  useBrowserOverlaySuspension();
  useBrowserNativeEvents();
  useEffect(() => prepareSparePage(), []);
  return null;
}
