import { lazy, Suspense } from "react";

const DesktopRegisterPage = lazy(() => import("./desktop"));

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <DesktopRegisterPage />
    </Suspense>
  );
}
