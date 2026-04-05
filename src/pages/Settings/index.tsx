import { lazy, Suspense } from "react";

const DesktopSettingsPage = lazy(() => import("./desktop"));

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <DesktopSettingsPage />
    </Suspense>
  );
}
