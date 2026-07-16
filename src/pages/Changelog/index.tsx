import { lazy, Suspense } from "react";

const DesktopChangelogPage = lazy(() => import("./desktop"));

export default function ChangelogPage() {
  return (
    <Suspense fallback={null}>
      <DesktopChangelogPage />
    </Suspense>
  );
}
