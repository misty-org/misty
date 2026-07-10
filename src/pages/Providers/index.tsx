import { lazy, Suspense } from "react";
import { detectAppFormFactor } from "../../platform/formFactor";
import MobileProvidersPage from "./mobile";

const DesktopProvidersPage = import.meta.env.MODE === "mobile"
  ? null
  : lazy(() => import("./desktop"));

export default function ProvidersPage() {
  if (detectAppFormFactor() === "mobile" || !DesktopProvidersPage) return <MobileProvidersPage />;
  return (
    <Suspense fallback={null}>
      <DesktopProvidersPage />
    </Suspense>
  );
}
