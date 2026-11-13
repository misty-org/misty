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
import { isAuthPath, isSignedOutPath, routes } from "@/app/shell";
import { useSetupStore } from "@/features/account";
import { desktopRouteIdFromPath } from "../routing/navigation";
import { UnsavedQuitGuard } from "@/features/app-windows";
import { SpaceWindowBridge } from "@/features/spaces";
import { accountScopeFor } from "@/features/app-windows";

// Load the layout alongside account/workspace restore so they share one stable loading scene
// instead of swapping Suspense fallbacks. The scene fades out once the app is ready
// (`LoadingScreen`), but never before it has shown for `minimumSplashMs`.
const desktopLayoutPromise = import("@/app/layouts/DesktopLayout").then((layout) => ({
  default: layout.DesktopLayout,
}));
const DesktopLayout = lazy(() => desktopLayoutPromise);
/** Half of each of Misty's sweeps (6s across, 4.5s up and down). */
const splashStartsCentered =
  "[&_.misty-fly-x]:[animation-delay:-3s] [&_.misty-fly-y]:[animation-delay:-2.25s]";
/** A splash shorter than this reads as a flicker, so a quick load still shows Misty this long. */
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

  // A person is signed in to use Misty. Signed out, only the welcome and the sign-in pages show:
  // anything else, invite links included, goes to sign in (the welcome on first run) and comes
  // back once signed in. The first sign-in sets up the person's AI and apps before the app opens.
  const here = `${location.pathname}${location.search}${location.hash}`;
  const returnTo = isAuthRoute || location.pathname === routes.root ? undefined : here;
  const signInFirst = !user && !transitioning && !isSignedOutPath(location.pathname);
  const setUpFirst = Boolean(user) && !transitioning && !welcomed && !isAuthRoute;
  // Account transitions finish before the shell shows; the window then waits for the account's
  // saved windows and tabs.
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
  // Keep hook order stable as identity changes: every hook runs before the returns below.
  const [leavingLabel, clearLeaving] = useLeavingLoadingScreen(loadingLabel);

  // One splash, keyed, from loading through leaving: the same Misty keeps flying while the shell
  // mounts under her, instead of a new one starting her flight over as the old one goes.
  const splashLabel = loadingLabel ?? leavingLabel;
  const leavingScreen = splashLabel ? (
    <LoadingScreen
      key="splash"
      fullScreen
      // Misty's sweep starts at the left end of her track, so a window that paints its first
      // frame and then holds it (hidden right after a reload) showed her stuck at the edge. Half a
      // pass in, she starts in the middle, heading out.
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
    return <Navigate to={routes.setup} replace state={returnTo ? { from: returnTo } : null} />;
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
      {/* Another account starts the shell over, with nothing of the last one's left mounted. */}
      <Suspense key={`account:${user?.id ?? "anonymous"}`} fallback={null}>
        <DesktopLayout getRouteId={desktopRouteIdFromPath} />
      </Suspense>
      <SpacesRealtimeBridge />
      <SpaceWindowBridge />
      <AgentExecutionSurface />
      <UpdateNotices accountScope={accountScope} />
      <UnsavedQuitGuard />
      {leavingScreen}
    </>
  );
}

/**
 * `loadingLabel`, held for at least `minimumSplashMs` from when the splash first showed: a load that
 * finishes sooner keeps its last label until then, and one that takes longer ends as it finishes.
 */
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
