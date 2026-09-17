import { LoadingScreen } from "@/shared/ui/loading-screen";
import { AgentExecutionSurface } from "@/features/agents/AgentExecutionSurface";
import { ActivityPanel } from "@/features/activity/ActivityPanel";
import { configurePluginSpaceAuthority } from "@/native/settings-plugins";
import { UpdateNotices } from "@/features/updater/UpdateNotices";
import { lazy, Suspense, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/features/auth";
import { OnboardingFlow } from "@/features/onboarding/OnboardingFlow";
import { desktopNavItems, desktopRouteIdFromPath } from "../routing/navigation";
import { ConnectedDevicesProvider } from "@/features/connected-devices";
import { useAppsStore } from "@/features/apps";

const PlatformLayout = lazy(() => import("@/application/platform-layout"));

export function AppFrameLayout() {
  const { user, transitioning } = useAuth();
  const location = useLocation();
  const isAuthRoute = location.pathname === "/signin" || location.pathname === "/register";
  const isInviteRoute = location.pathname.startsWith("/invite/");

  useEffect(() => {
    if (!user?.id) {
      useAppsStore.getState().reset();
      return;
    }
    if (user?.id) {
      useAppsStore.getState().selectAccount(user.id);
    }
  }, [user?.id]);

  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ accountId: string; spaceId: string }>).detail;
      if (user?.id && detail.accountId === user.id)
        void useAppsStore.getState().invalidate(user.id, detail.spaceId);
    };
    window.addEventListener("misty:space-apps-changed", refresh);
    return () => window.removeEventListener("misty:space-apps-changed", refresh);
  }, [user?.id]);

  useEffect(
    () =>
      configurePluginSpaceAuthority(async () => {
        const initial = useAppsStore.getState();
        if (!initial.accountId) return new Set<string>();
        await initial.load(initial.accountId, true);
        const current = useAppsStore.getState();
        if (current.accountId !== initial.accountId || current.error) return new Set<string>();
        return new Set(
          current.installations
            .filter((app) => app.state === "installed" && !app.consent_required)
            .map((app) => app.app_id),
        );
      }),
    [],
  );

  // Keep hook order stable as identity changes, and let account transitions
  // finish before deciding that the user needs to sign in.
  if (transitioning && !isAuthRoute) return <LoadingScreen fullScreen label="Restoring account" />;

  if (!user && !isAuthRoute && !isInviteRoute) {
    return (
      <Navigate to="/signin" state={{ from: `${location.pathname}${location.search}` }} replace />
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
      <Suspense fallback={<LoadingScreen fullScreen />}>
        <ConnectedDevicesProvider>
          <PlatformLayout getRouteId={desktopRouteIdFromPath} navItems={desktopNavItems} />
        </ConnectedDevicesProvider>
      </Suspense>
      <AgentExecutionSurface />
      <ActivityPanel />
      <OnboardingFlow />
      <UpdateNotices accountId={user?.id ?? ""} />
    </>
  );
}
