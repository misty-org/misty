import { nativeWorkspaceRecoveryEnabled } from "@/features/workspace/workspaceRecoveryPlatform";
import { restoreAccountWorkspace } from "@/features/workspace/workspaceAccountState";
import { useWorkspaceRecoveryState } from "@/features/workspace/nativeWorkspaceRecovery";
import { readApiAuthToken } from "@/api/client/session";
import { Button } from "@/shared/ui";
import { BrowserSyncStartup } from "@/features/browser-workspace/BrowserSyncStartup";
import { BrowserSyncBridge } from "@/features/browser-workspace/BrowserSyncBridge";
import { SpacesRealtimeBridge } from "@/features/spaces/SpacesRealtimeBridge";
import { LoadingScreen } from "@/shared/ui/loading-screen";
import { AgentExecutionSurface } from "@/features/agents/AgentExecutionSurface";
import { ActivityPanel } from "@/features/activity/ActivityPanel";
import { UpdateNotices } from "@/features/updater/UpdateNotices";
import { lazy, Suspense } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/features/auth";
import { desktopNavItems, desktopRouteIdFromPath } from "../routing/navigation";
import { ConnectedDevicesProvider } from "@/features/connected-devices";

const PlatformLayout = lazy(() => import("@/application/platform-layout"));

export function AppFrameLayout() {
  const { user, transitioning, logout } = useAuth();
  const recovery = useWorkspaceRecoveryState();
  const location = useLocation();
  const isAuthRoute = location.pathname === "/signin" || location.pathname === "/register";
  const isInviteRoute = location.pathname.startsWith("/invite/");

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
    nativeWorkspaceRecoveryEnabled() &&
    (recovery.accountId !== user.id || !recovery.ready)
  ) {
    const issue = recovery.accountId === user.id ? recovery.issue : null;
    if (!issue) return <LoadingScreen fullScreen label="Restoring workspace" />;
    const report = (error: unknown) => {
      if (useWorkspaceRecoveryState.getState().accountId === user.id)
        useWorkspaceRecoveryState.setState({
          issue: error instanceof Error ? error.message : String(error),
        });
    };
    return (
      <div className="flex min-h-screen items-center justify-center bg-charcoal-bg p-6 text-cream">
        <div className="grid max-w-lg gap-4">
          <h1 className="text-lg font-semibold">Your workspace could not be restored</h1>
          <p role="alert" className="text-sm text-cream-muted">
            {issue}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                void readApiAuthToken()
                  .then(() => restoreAccountWorkspace(user.id))
                  .catch(report);
              }}
            >
              Retry
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void logout().catch(report);
              }}
            >
              Choose account
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (isAuthRoute) {
    return (
      <Suspense fallback={<LoadingScreen fullScreen />}>
        <PlatformLayout getRouteId={desktopRouteIdFromPath} navItems={desktopNavItems} />
      </Suspense>
    );
  }

  return (
    <>
      <BrowserSyncStartup key={user?.id} accountId={user?.id ?? ""}>
        <Suspense fallback={<LoadingScreen fullScreen />}>
          <ConnectedDevicesProvider>
            <PlatformLayout getRouteId={desktopRouteIdFromPath} navItems={desktopNavItems} />
          </ConnectedDevicesProvider>
        </Suspense>
      </BrowserSyncStartup>
      <BrowserSyncBridge accountId={user?.id ?? ""} />
      <SpacesRealtimeBridge />
      <AgentExecutionSurface />
      <ActivityPanel />
      <UpdateNotices accountId={user?.id ?? ""} />
    </>
  );
}
