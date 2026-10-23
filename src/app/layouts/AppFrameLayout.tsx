import { nativeWorkspaceRecoveryEnabled } from "@/features/workspace/workspaceRecoveryPlatform";
import { useWorkspaceRecoveryState } from "@/features/workspace/nativeWorkspaceRecovery";
import { useWorkspaceRecoveryRetry } from "@/features/workspace/useWorkspaceRecoveryRetry";
import { BrowserSyncStartup } from "@/features/browser-sync/BrowserSyncStartup";
import { BrowserSyncSleepOverlay } from "@/features/browser-sync/BrowserSyncSleepOverlay";
import { BrowserSyncBridge } from "@/features/browser-sync/BrowserSyncBridge";
import { PageStateBridge } from "@/features/browser-sync/PageStateBridge";
import { SpacesRealtimeBridge } from "@/features/spaces/SpacesRealtimeBridge";
import { LoadingScreen } from "@/shared/ui";
import { AgentExecutionSurface } from "@/features/agents/AgentExecutionSurface";
import { UpdateNotices } from "@/features/updater/UpdateNotices";
import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/features/auth";
import { isAuthPath } from "@/features/app-shell";
import { desktopRouteIdFromPath } from "../routing/navigation";
import { ConnectedDevicesProvider } from "@/features/connected-devices";
import { UnsavedQuitGuard } from "@/features/workspace/UnsavedQuitGuard";
import { useSpaceWindowStore } from "@/features/workspace/spaceWindow";
import { SpaceWindowBridge } from "@/features/workspace/SpaceWindowBridge";

// Let the initial Misty flight finish before revealing the app, even when its
// code is already cached. Load the layout alongside account/workspace restore so
// they can share one stable loading scene instead of swapping Suspense fallbacks.
const initialFlight = new Promise<void>((resolve) => setTimeout(resolve, 2_000));
const desktopLayoutPromise = Promise.all([
  import("@/app/layouts/DesktopLayout"),
  initialFlight,
]).then(([layout]) => ({ default: layout.DesktopLayout }));
const DesktopLayout = lazy(() => desktopLayoutPromise);

export function AppFrameLayout() {
  const { user, transitioning } = useAuth();
  const [layoutReady, setLayoutReady] = useState(false);
  useEffect(() => {
    let active = true;
    void desktopLayoutPromise.then(
      () => active && setLayoutReady(true),
      () => active && setLayoutReady(true),
    );
    return () => {
      active = false;
    };
  }, []);
  const recovery = useWorkspaceRecoveryState();
  const location = useLocation();
  const isAuthRoute = isAuthPath(location.pathname);
  const isInviteRoute = location.pathname.startsWith("/invite/");
  useWorkspaceRecoveryRetry(!isAuthRoute && !transitioning ? (user?.id ?? "") : "");
  // An incognito window keeps nothing and never syncs. Any other window syncs the tabs
  // of the Space it shows, through that Space's vault; switching restarts the bridge.
  const { incognito, key: spaceKey } = useSpaceWindowStore((state) => state.identity);
  const syncAllowed =
    !incognito &&
    (!nativeWorkspaceRecoveryEnabled() || (recovery.accountId === user?.id && recovery.ready));

  // Keep hook order stable as identity changes, and let account transitions
  // finish before deciding that the user needs to sign in.
  if (transitioning && !isAuthRoute) return <LoadingScreen fullScreen label="Restoring account" />;

  if (!user && !isAuthRoute && !isInviteRoute) {
    return (
      <Navigate to="/signin" state={{ from: `${location.pathname}${location.search}` }} replace />
    );
  }

  if (
    !isAuthRoute &&
    user &&
    !incognito &&
    nativeWorkspaceRecoveryEnabled() &&
    (recovery.accountId !== user.id || (!recovery.ready && !recovery.usable))
  ) {
    return <LoadingScreen fullScreen label="Restoring workspace" />;
  }

  if (!layoutReady) return <LoadingScreen fullScreen label="Opening Misty" />;

  if (isAuthRoute) {
    return (
      <Suspense fallback={null}>
        <DesktopLayout getRouteId={desktopRouteIdFromPath} />
      </Suspense>
    );
  }

  return (
    <>
      <BrowserSyncStartup
        key={`sync-startup:${user?.id ?? "anonymous"}`}
        accountId={syncAllowed ? (user?.id ?? "") : ""}
      >
        <Suspense fallback={null}>
          <ConnectedDevicesProvider>
            <DesktopLayout getRouteId={desktopRouteIdFromPath} />
          </ConnectedDevicesProvider>
        </Suspense>
      </BrowserSyncStartup>
      <BrowserSyncBridge key={spaceKey} accountId={syncAllowed ? (user?.id ?? "") : ""} />
      <PageStateBridge accountId={syncAllowed ? (user?.id ?? "") : ""} />
      <SpacesRealtimeBridge />
      <SpaceWindowBridge />
      {incognito ? null : <AgentExecutionSurface />}
      <UpdateNotices accountId={user?.id ?? ""} />
      <UnsavedQuitGuard />
      <BrowserSyncSleepOverlay
        key={`sync-sleep:${user?.id ?? "anonymous"}`}
        accountId={syncAllowed ? (user?.id ?? "") : ""}
      />
    </>
  );
}
