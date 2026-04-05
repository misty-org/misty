import { lazy, Suspense } from "react";

const DesktopProvidersPage = lazy(() => import("./desktop"));

export default function ProvidersPage() {
  return (
    <Suspense fallback={null}>
      <DesktopProvidersPage />
    </Suspense>
  );
}
