import { lazy, Suspense } from "react";

const DesktopChangelogPage = import.meta.env.MODE === "mobile" || import.meta.env.VITE_MISTY_TARGET === "android"
  ? null
  : lazy(() => import("./desktop"));
const MobileChangelogPage = import.meta.env.MODE === "mobile"
  ? lazy(() => import("./mobile"))
  : null;

export default function ChangelogPage() {
  if (MobileChangelogPage) {
    return (
      <Suspense fallback={null}>
        <MobileChangelogPage />
      </Suspense>
    );
  }
  if (!DesktopChangelogPage) return null;
  return (
    <Suspense fallback={null}>
      <DesktopChangelogPage />
    </Suspense>
  );
}
