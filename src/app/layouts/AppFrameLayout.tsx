import { nativeWorkspaceRecoveryEnabled } from "@/features/app-windows";
import { useWorkspaceRecoveryState } from "@/features/app-windows";
import { useWorkspaceRecoveryRetry } from "@/features/app-windows";
import { PageStateBridge } from "@/features/browser";
import { SpacesRealtimeBridge } from "@/features/spaces/SpacesRealtimeBridge";
import { LoadingScreen } from "@/shared/ui";
import { AgentExecutionSurface } from "@/features/agents";
import { UpdateNotices } from "@/features/updater/UpdateNotices";
import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/features/account";
import { isAuthPath, routes } from "@/app/shell";
import { useSetupStore } from "@/features/account";
import { desktopRouteIdFromPath } from "../routing/navigation";
import { DeviceSessionBridge } from "@/features/agents";
import { UnsavedQuitGuard } from "@/features/app-windows";
import { useProfileWindowStore } from "@/features/app-windows";
import { SpaceWindowBridge } from "@/features/spaces";
import { accountScopeFor } from "@/features/app-windows";

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
  const welcomed = useSetupStore((state) => state.welcomed);
  // Browsing data belongs to the signed-in account, or to the local profile with none.
  const accountScope = accountScopeFor(user?.id);
  useWorkspaceRecoveryRetry(!isAuthRoute && !transitioning ? accountScope : "");
  // An incognito window keeps nothing. Any other window keeps its pages' state once its
  // saved tabs are back.
  const incognito = useProfileWindowStore((state) => state.incognito);
  const keepsPageState =
    !incognito &&
    (!nativeWorkspaceRecoveryEnabled() || (recovery.accountId === accountScope && recovery.ready));

  // First run shows the welcome once, before the shell mounts: the shell sends a bare "/"
  // straight to the active tab, which would skip it. Invite links go through.
  const showWelcome = !user && !welcomed && !isAuthRoute && !isInviteRoute;
  // Account transitions finish before the shell shows. Misty is a full browser without an
  // account, so nothing here sends anyone to sign in; the window waits only for its
  // profile's saved windows and tabs.
  const loadingLabel =
    transitioning && !isAuthRoute
      ? "Restoring account"
      : showWelcome
        ? null
        : !isAuthRoute &&
            !incognito &&
            nativeWorkspaceRecoveryEnabled() &&
            (recovery.accountId !== accountScope || (!recovery.ready && !recovery.usable))
          ? "Restoring workspace"
          : !layoutReady
            ? "Opening Misty"
            : null;
  // Keep hook order stable as identity changes: every hook runs before the returns below.
  const [leavingLabel, clearLeaving] = useLeavingLoadingScreen(loadingLabel);

  if (loadingLabel) return <LoadingScreen fullScreen label={loadingLabel} />;
  if (showWelcome) return <Navigate to={routes.welcome} replace />;

  const leavingScreen = leavingLabel ? (
    <LoadingScreen fullScreen label={leavingLabel} leaving onLeft={clearLeaving} />
  ) : null;

  if (isAuthRoute) {
    return (
      <>
        <Suspense fallback={null}>
          <DesktopLayout getRouteId={desktopRouteIdFromPath} />
        </Suspense>
        {leavingScreen}
      </>
    );
  }

  return (
    <>
      {/* Another account starts the shell over, with nothing of the last one's left mounted. */}
      <Suspense key={`account:${user?.id ?? "anonymous"}`} fallback={null}>
        <DesktopLayout getRouteId={desktopRouteIdFromPath} />
      </Suspense>
      <DeviceSessionBridge />
      <PageStateBridge enabled={keepsPageState} />
      <SpacesRealtimeBridge />
      <SpaceWindowBridge />
      {incognito ? null : <AgentExecutionSurface />}
      <UpdateNotices accountScope={accountScope} />
      <UnsavedQuitGuard />
      {leavingScreen}
    </>
  );
}

/** The loading screen the shell just replaced, kept while it fades out over the shell. */
function useLeavingLoadingScreen(loadingLabel: string | null) {
  const [shown, setShown] = useState(loadingLabel);
  const [leaving, setLeaving] = useState<string | null>(null);
  if (shown !== loadingLabel) {
    setShown(loadingLabel);
    setLeaving(loadingLabel ? null : shown);
  }
  return [leaving, () => setLeaving(null)] as const;
}
