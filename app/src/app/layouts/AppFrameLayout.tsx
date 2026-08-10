import { lazy, Suspense } from "react";
import { isWebBuild } from "@/shared/platform/buildTarget";
import { desktopNavItems, desktopRouteIdFromPath } from "../routing/navigation";
import { WebAppFrameLayout } from "./WebAppFrameLayout";

const DesktopLayout = lazy(() =>
  import("./DesktopLayout").then((module) => ({ default: module.DesktopLayout })),
);

export function AppFrameLayout() {
  if (isWebBuild) return <WebAppFrameLayout />;

  return (
    <Suspense fallback={null}>
      <DesktopLayout getRouteId={desktopRouteIdFromPath} navItems={desktopNavItems} />
    </Suspense>
  );
}
