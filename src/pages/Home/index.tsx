import { lazy, Suspense } from "react";

const DesktopHomePage = import.meta.env.MODE === "mobile"
  ? null
  : lazy(() => import("./desktop"));
const MobileHomePage = import.meta.env.MODE === "mobile"
  ? lazy(() => import("./mobile"))
  : null;

export default function HomePage() {
  if (MobileHomePage) {
    return (
      <Suspense fallback={null}>
        <MobileHomePage />
      </Suspense>
    );
  }
  if (!DesktopHomePage) return null;
  return (
    <Suspense fallback={null}>
      <DesktopHomePage />
    </Suspense>
  );
}
