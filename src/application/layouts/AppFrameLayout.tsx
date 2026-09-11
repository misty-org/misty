import { ActivityPanel } from "@/features/activity/ActivityPanel";
import { configurePluginSpaceAuthority } from "@/native/settings-plugins";
import { UpdateNotices } from "@/features/updater/UpdateNotices";
import { lazy, Suspense, useEffect } from "react";
import { useAuth } from "@/features/auth";
import { OnboardingFlow } from "@/features/onboarding/OnboardingFlow";
import { accountNeedsOnboarding } from "@/features/onboarding/onboardingState";
import { useSpacesStore } from "@/features/spaces";
import { desktopNavItems, desktopRouteIdFromPath } from "../routing/navigation";
import { ConnectedDevicesProvider } from "@/features/connected-devices";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { preferredDefaultSpace } from "@/features/spaces/defaultSpace";
import { useAppsStore } from "@/features/apps";

const PlatformLayout = lazy(() => import("@/application/platform-layout"));

export function AppFrameLayout() {
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const scope = useWorkspaceStore((state) => state.activeScopeKey);
  const spaceId = scope.startsWith("space:")
    ? scope.slice(6)
    : (preferredDefaultSpace(spaces)?.id ?? "");
  const snapshotReady = useSpacesStore((state) => state.snapshotReady);
  const needsOnboarding = accountNeedsOnboarding(user?.id, snapshotReady, spaces);

  useEffect(() => {
    if (user?.id) useAppsStore.getState().selectSpace(user.id, spaceId);
    else useAppsStore.getState().reset();
  }, [user?.id, spaceId]);

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
        if (!initial.spaceId || !initial.accountId) return new Set<string>();
        await initial.load(initial.accountId, true, initial.spaceId);
        const current = useAppsStore.getState();
        if (
          current.accountId !== initial.accountId ||
          current.spaceId !== initial.spaceId ||
          current.error
        )
          return new Set<string>();
        return new Set(
          current.installations.filter((app) => app.state === "installed").map((app) => app.app_id),
        );
      }),
    [],
  );

  if (needsOnboarding) {
    return <OnboardingFlow />;
  }

  return (
    <>
      <Suspense fallback={null}>
        <ConnectedDevicesProvider>
          <PlatformLayout getRouteId={desktopRouteIdFromPath} navItems={desktopNavItems} />
        </ConnectedDevicesProvider>
      </Suspense>
      <ActivityPanel />
      <OnboardingFlow />
      <UpdateNotices accountId={user?.id ?? ""} />
    </>
  );
}
