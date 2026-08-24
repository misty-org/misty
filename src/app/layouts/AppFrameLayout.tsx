import { nativeWorkspaceRecoveryEnabled } from "@/features/workspace/workspaceRecoveryPlatform";
import { useWorkspaceRecoveryState } from "@/features/workspace/nativeWorkspaceRecovery";
import { useWorkspaceRecoveryRetry } from "@/features/workspace/useWorkspaceRecoveryRetry";
import { BrowserSyncStartup } from "@/features/browser-workspace/BrowserSyncStartup";
import { BrowserSyncSleepOverlay } from "@/features/browser-workspace/BrowserSyncSleepOverlay";
import { BrowserSyncBridge } from "@/features/browser-workspace/BrowserSyncBridge";
import { PageStateBridge } from "@/features/browser-workspace/PageStateBridge";
import { SpacesRealtimeBridge } from "@/features/spaces/SpacesRealtimeBridge";
import { LoadingScreen } from "@/shared/ui";
import { AgentExecutionSurface } from "@/features/agents/AgentExecutionSurface";
import { ActivityPanel } from "@/features/activity/ActivityPanel";
import { UpdateNotices } from "@/features/updater/UpdateNotices";
import { lazy, Suspense } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/features/auth";
import { desktopRouteIdFromPath } from "../routing/navigation";
import { ConnectedDevicesProvider, DevicePairingLinkDialog } from "@/features/connected-devices";
import { useSettingsStore } from "@/features/settings";
import { UnsavedQuitGuard } from "@/features/workspace/UnsavedQuitGuard";

const DesktopLayout = lazy(() =>
  import("@/app/layouts/DesktopLayout").then(({ DesktopLayout }) => ({ default: DesktopLayout })),
);

export function AppFrameLayout() {
  const { user, transitioning } = useAuth();
  const recovery = useWorkspaceRecoveryState();
  const location = useLocation();
  const deviceSessionDays = useSettingsStore((store) => {
    const files = store.settings?.document.files as Record<string, unknown> | undefined;
    return Number(files?.device_session_days ?? 30) || 30;
  });
  const isAuthRoute = location.pathname === "/signin" || location.pathname === "/register";
  const isInviteRoute = location.pathname.startsWith("/invite/");
  useWorkspaceRecoveryRetry(!isAuthRoute && !transitioning ? (user?.id ?? "") : "");
  const syncAllowed =
    !nativeWorkspaceRecoveryEnabled() || (recovery.accountId === user?.id && recovery.ready);

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
    (recovery.accountId !== user.id || (!recovery.ready && !recovery.usable))
  ) {
    return <LoadingScreen fullScreen label="Restoring workspace" />;
  }

  if (isAuthRoute) {
    return (
      <Suspense fallback={<LoadingScreen fullScreen />}>
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
        <Suspense fallback={<LoadingScreen fullScreen />}>
          <ConnectedDevicesProvider sessionDays={deviceSessionDays}>
            <DesktopLayout getRouteId={desktopRouteIdFromPath} />
            <DevicePairingLinkDialog />
          </ConnectedDevicesProvider>
        </Suspense>
      </BrowserSyncStartup>
      <BrowserSyncBridge accountId={syncAllowed ? (user?.id ?? "") : ""} />
      <PageStateBridge accountId={syncAllowed ? (user?.id ?? "") : ""} />
      <SpacesRealtimeBridge />
      <AgentExecutionSurface />
      <ActivityPanel />
      <UpdateNotices accountId={user?.id ?? ""} />
      <UnsavedQuitGuard />
      <BrowserSyncSleepOverlay
        key={`sync-sleep:${user?.id ?? "anonymous"}`}
        accountId={syncAllowed ? (user?.id ?? "") : ""}
      />
    </>
  );
}
