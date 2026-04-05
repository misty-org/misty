import { lazy, Suspense } from "react";

const DesktopAccountPage = lazy(() => import("./desktop"));

export default function AccountPage() {
  return (
    <Suspense fallback={null}>
      <DesktopAccountPage />
    </Suspense>
  );
}
