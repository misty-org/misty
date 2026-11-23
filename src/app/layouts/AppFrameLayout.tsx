import { nativeWorkspaceRecoveryEnabled } from "@/features/app-windows";
import { useWorkspaceRecoveryState } from "@/features/app-windows";
import { useWorkspaceRecoveryRetry } from "@/features/app-windows";
import { SpacesRealtimeBridge } from "@/features/spaces/SpacesRealtimeBridge";
import { SpaceDriveBridge } from "@/features/spaces/drive";
import { LoadingScreen } from "@misty/ui";
import { AgentExecutionSurface, defaultChoices, useEnginesList } from "@/features/agents";
import { UpdateNotices } from "@/features/updater/UpdateNotices";
import { EngineUpdatesPrompt } from "@/features/engine-config/clis";
import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/features/account";
import { isAuthPath, isSignedOutPath, routes } from "@/app/shell";
import { useSetupStore } from "@/features/account";
import { desktopRouteIdFromPath } from "../routing/navigation";
import { UnsavedQuitGuard } from "@/features/app-windows";
import { SpaceWindowBridge } from "@/features/spaces";
import { accountScopeFor } from "@/features/app-windows";

const desktopLayoutPromise = import("@/app/layouts/DesktopLayout").then((layout) => ({
  default: layout.DesktopLayout,
}));
const DesktopLayout = lazy(() => desktopLayoutPromise);
const splashStartsCentered =
  "[&_.misty-fly-x]:[animation-delay:-3s] [&_.misty-fly-y]:[animation-delay:-2.25s]";
const minimumSplashMs = 1000;

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
  const welcomed = useSetupStore((state) => state.welcomed);
  const accountScope = accountScopeFor(user?.id);
  useWorkspaceRecoveryRetry(user && !isAuthRoute && !transitioning ? accountScope : "");

  const here = `${location.pathname}${location.search}${location.hash}`;
  const returnTo = isAuthRoute || location.pathname === routes.root ? undefined : here;
  const signInFirst = !user && !transitioning && !isSignedOutPath(location.pathname);
  const engines = useEnginesList();
  const noEngine = Boolean(engines.data) && defaultChoices(engines.data ?? []).length === 0;
  const onSetup = location.pathname === routes.setup;
  const engineFirst =
    Boolean(user) && !transitioning && welcomed && noEngine && !isAuthRoute && !onSetup;
  const setUpFirst = (Boolean(user) && !transitioning && !welcomed && !isAuthRoute) || engineFirst;
  const readyLabel =
    transitioning && !isAuthRoute
      ? "Restoring account"
      : signInFirst || setUpFirst
        ? null
        : !isAuthRoute &&
            nativeWorkspaceRecoveryEnabled() &&
            (recovery.accountId !== accountScope || (!recovery.ready && !recovery.usable))
          ? "Restoring workspace"
          : !layoutReady
            ? "Opening Misty"
            : null;
  const loadingLabel = useMinimumSplash(readyLabel);
  const [leavingLabel, clearLeaving] = useLeavingLoadingScreen(loadingLabel);

  const splashLabel = loadingLabel ?? leavingLabel;
  const leavingScreen = splashLabel ? (
    <LoadingScreen
      key="splash"
      fullScreen
      className={splashStartsCentered}
      label={splashLabel}
      leaving={!loadingLabel}
      onLeft={clearLeaving}
    />
  ) : null;
  if (signInFirst)
    return (
      <Navigate
        to={welcomed ? routes.signIn : routes.welcome}
        replace
        state={returnTo ? { from: returnTo } : null}
      />
    );
  if (setUpFirst)
    return (
      <Navigate
        to={routes.setup}
        replace
        state={{
          ...(returnTo ? { from: returnTo } : {}),
          ...(engineFirst ? { engineOnly: true } : {}),
        }}
      />
    );
  if (loadingLabel) return <>{leavingScreen}</>;

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
      <Suspense key={`account:${user?.id ?? "anonymous"}`} fallback={null}>
        <DesktopLayout getRouteId={desktopRouteIdFromPath} />
      </Suspense>
      <SpacesRealtimeBridge />
      <SpaceDriveBridge />
      <SpaceWindowBridge />
      <AgentExecutionSurface />
      <UpdateNotices accountScope={accountScope} />
      <EngineUpdatesPrompt accountScope={accountScope} />
      <UnsavedQuitGuard />
      {leavingScreen}
    </>
  );
}

function useMinimumSplash(loadingLabel: string | null): string | null {
  const [splash, setSplash] = useState(() =>
    loadingLabel ? { label: loadingLabel, since: performance.now() } : null,
  );
  if (loadingLabel && splash?.label !== loadingLabel)
    setSplash({ label: loadingLabel, since: splash?.since ?? performance.now() });
  const done =
    !loadingLabel && splash !== null && performance.now() - splash.since >= minimumSplashMs;
  if (done) setSplash(null);
  useEffect(() => {
    if (loadingLabel || !splash) return;
    const timer = window.setTimeout(
      () => setSplash(null),
      splash.since + minimumSplashMs - performance.now(),
    );
    return () => window.clearTimeout(timer);
  }, [loadingLabel, splash]);
  return loadingLabel ?? (done ? null : (splash?.label ?? null));
}

function useLeavingLoadingScreen(loadingLabel: string | null) {
  const [shown, setShown] = useState(loadingLabel);
  const [leaving, setLeaving] = useState<string | null>(null);
  if (shown !== loadingLabel) {
    setShown(loadingLabel);
    setLeaving(loadingLabel ? null : shown);
  }
  return [leaving, () => setLeaving(null)] as const;
}
