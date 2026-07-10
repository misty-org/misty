import { lazy, Suspense } from "react";
import { Navigate } from "react-router-dom";
import { isAndroidBuild } from "../../platform/buildTarget";

const DesktopExtensionsPage = import.meta.env.MODE === "mobile" || import.meta.env.VITE_MISTY_TARGET === "android"
  ? null
  : lazy(() => import("./desktop"));
const MobileExtensionsPage = import.meta.env.MODE === "mobile"
  ? lazy(() => import("./mobile"))
  : null;

export default function ExtensionsPage() {
  if (isAndroidBuild) return <Navigate to="/files" replace />;
  if (MobileExtensionsPage) {
    return (
      <Suspense fallback={null}>
        <MobileExtensionsPage />
      </Suspense>
    );
  }
  if (!DesktopExtensionsPage) return null;
  return (
    <Suspense fallback={null}>
      <DesktopExtensionsPage />
    </Suspense>
  );
}
