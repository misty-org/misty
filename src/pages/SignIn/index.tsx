import { lazy, Suspense } from "react";

const DesktopSignInPage = lazy(() => import("./desktop"));

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <DesktopSignInPage />
    </Suspense>
  );
}
