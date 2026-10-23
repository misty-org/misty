import { useNavigate } from "react-router-dom";
import { useBrowserNativeEvents } from "./useBrowserNativeEvents";
import { useBrowserOverlaySuspension, useBrowserPointerSuspension } from "./useBrowserSuspension";
import { useBrowserRuntimeServices } from "./useBrowserRuntimeServices";
import {
  useBrowserFocusReturn,
  useBrowserSurfaceParking,
  useClosedBrowserTabCleanup,
  useInstantBrowserSwitch,
} from "./useBrowserWorkspaceSync";

export { browserBlockingOverlayOpen } from "./browserBlockingOverlay";

export function BrowserRuntimeBridge() {
  const navigate = useNavigate();
  useBrowserRuntimeServices();
  useInstantBrowserSwitch();
  useBrowserFocusReturn();
  useBrowserSurfaceParking();
  useClosedBrowserTabCleanup();
  useBrowserPointerSuspension();
  useBrowserOverlaySuspension();
  useBrowserNativeEvents(navigate);
  return null;
}
