import { lazy, Suspense } from "react";

const DesktopHomePage = lazy(() => import("./desktop"));

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <DesktopHomePage />
    </Suspense>
  );
}
