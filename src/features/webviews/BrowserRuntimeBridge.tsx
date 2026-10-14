import { useNavigate } from "react-router-dom";
import { profileDataIdForView } from "@/features/workspace/browserProfiles";
import { useWorkspaceStore } from "@/features/workspace";
import { setBrowserProfileResolver } from "./browserProfileResolver";
import { useBrowserNativeEvents } from "./useBrowserNativeEvents";
import {
  useBrowserOverlaySuspension,
  useBrowserPointerSuspension,
  useEmbeddedBrowserSuspension,
} from "./useBrowserSuspension";
import { useBrowserRuntimeServices } from "./useBrowserRuntimeServices";
import { useBrowserSurfaceParking, useClosedBrowserTabCleanup } from "./useBrowserWorkspaceSync";

export { browserBlockingOverlayOpen } from "./browserBlockingOverlay";

// Registered when the bridge loads, before any page opens, so a view in a device
// profile always opens in that profile's own website data.
setBrowserProfileResolver((viewId) => profileDataIdForView(useWorkspaceStore.getState(), viewId));

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
