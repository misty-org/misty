import { useBrowserNativeEvents } from "./useBrowserNativeEvents";
import { useBrowserOverlaySuspension, useBrowserPointerSuspension } from "./useBrowserSuspension";

export { browserBlockingOverlayOpen } from "@/features/app-windows";

export function BrowserRuntimeBridge() {
  useBrowserPointerSuspension();
  useBrowserOverlaySuspension();
  useBrowserNativeEvents();
  return null;
}
