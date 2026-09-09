import { UpdateNotices } from "@/features/updater/UpdateNotices";
import { lazy, Suspense, useEffect } from "react";
import { useAuth } from "@/features/auth";
import { OnboardingFlow } from "@/features/onboarding/OnboardingFlow";
import { accountNeedsOnboarding } from "@/features/onboarding/onboardingState";
import { useSpacesStore } from "@/features/spaces";
import { desktopNavItems, desktopRouteIdFromPath } from "../routing/navigation";
import { ConnectedDevicesProvider } from "@/features/connected-devices";
import { useAppsStore } from "@/features/apps";

const PlatformLayout = lazy(() => import("@/application/platform-layout"));

export function AppFrameLayout() {
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const snapshotReady = useSpacesStore((state) => state.snapshotReady);
  const needsOnboarding = accountNeedsOnboarding(user?.id, snapshotReady, spaces);

  useEffect(() => {
    if (user?.id) void useAppsStore.getState().load(user.id);
    else useAppsStore.getState().reset();
  }, [user?.id]);

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
      <OnboardingFlow />
      <UpdateNotices accountId={user?.id ?? ""} />
    </>
  );
}
