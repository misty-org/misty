import { nativeWorkspaceRecoveryEnabled } from "@/features/app-windows";
import { useWorkspaceRecoveryState } from "@/features/app-windows";
import { useWorkspaceRecoveryRetry } from "@/features/app-windows";
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
import { SpaceWindowBridge } from "@/features/spaces";
import { accountScopeFor } from "@/features/app-windows";

// Load the layout alongside account/workspace restore so they share one stable loading scene
// instead of swapping Suspense fallbacks. The scene itself lets Misty finish the pass she is on
// before it leaves (`LoadingScreen`), so nothing here holds the app back on a timer.
const desktopLayoutPromise = import("@/app/layouts/DesktopLayout").then((layout) => ({
  default: layout.DesktopLayout,
}));
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
            nativeWorkspaceRecoveryEnabled() &&
            (recovery.accountId !== accountScope || (!recovery.ready && !recovery.usable))
          ? "Restoring workspace"
          : !layoutReady
            ? "Opening Misty"
            : null;
  // Keep hook order stable as identity changes: every hook runs before the returns below.
  const [leavingLabel, clearLeaving] = useLeavingLoadingScreen(loadingLabel);

  // One splash, keyed, from loading through leaving: the same Misty keeps flying while the shell
  // mounts under her, instead of a new one starting her flight over as the old one goes.
  const splashLabel = loadingLabel ?? leavingLabel;
  const leavingScreen = splashLabel ? (
    <LoadingScreen
      key="splash"
      fullScreen
      label={splashLabel}
      leaving={!loadingLabel}
      onLeft={clearLeaving}
    />
  ) : null;
  if (loadingLabel) return <>{leavingScreen}</>;
  if (showWelcome) return <Navigate to={routes.welcome} replace />;

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
      <SpacesRealtimeBridge />
      <SpaceWindowBridge />
      <AgentExecutionSurface />
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
