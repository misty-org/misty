import { lazy, Suspense } from "react";
import { OnboardingFlow } from "@/features/onboarding";
import { desktopNavItems, desktopRouteIdFromPath } from "../routing/navigation";

const DesktopLayout = lazy(() =>
  import("./DesktopLayout").then((module) => ({ default: module.DesktopLayout })),
);

export function AppFrameLayout() {
  return (
    <>
      <Suspense fallback={null}>
        <DesktopLayout getRouteId={desktopRouteIdFromPath} navItems={desktopNavItems} />
      </Suspense>
      <OnboardingFlow />
    </>
  );
}
