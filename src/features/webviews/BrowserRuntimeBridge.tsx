import { useNavigate } from "react-router-dom";
import { useBrowserNativeEvents } from "./useBrowserNativeEvents";
import {
  useBrowserOverlaySuspension,
  useBrowserPointerSuspension,
  useEmbeddedBrowserSuspension,
} from "./useBrowserSuspension";
import { useBrowserRuntimeServices } from "./useBrowserRuntimeServices";
import { useBrowserSurfaceParking, useClosedBrowserTabCleanup } from "./useBrowserWorkspaceSync";

export { browserBlockingOverlayOpen } from "./browserBlockingOverlay";

export function BrowserRuntimeBridge() {
  const navigate = useNavigate();
  useBrowserRuntimeServices();
  useBrowserSurfaceParking();
  useEmbeddedBrowserSuspension();
  useClosedBrowserTabCleanup();
  useBrowserPointerSuspension();
  useBrowserOverlaySuspension();
  useBrowserNativeEvents(navigate);
  return null;
}
