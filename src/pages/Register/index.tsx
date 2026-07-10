import { lazy, Suspense } from "react";

const DesktopRegisterPage = import.meta.env.MODE === "mobile"
  ? null
  : lazy(() => import("./desktop"));
const MobileRegisterPage = import.meta.env.MODE === "mobile"
  ? lazy(() => import("./mobile"))
  : null;

export default function RegisterPage() {
  if (MobileRegisterPage) {
    return (
      <Suspense fallback={null}>
        <MobileRegisterPage />
      </Suspense>
    );
  }
  if (!DesktopRegisterPage) return null;
  return (
    <Suspense fallback={null}>
      <DesktopRegisterPage />
    </Suspense>
  );
}
