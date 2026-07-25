import { lazy, Suspense } from "react";

const DesktopExtensionsPage = lazy(() => import("./desktop"));

export default function ExtensionsPage() {
  return (
    <Suspense fallback={null}>
      <DesktopExtensionsPage />
    </Suspense>
  );
}
