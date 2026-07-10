import { lazy, Suspense } from "react";

const DesktopSignInPage = import.meta.env.MODE === "mobile"
  ? null
  : lazy(() => import("./desktop"));
const MobileSignInPage = import.meta.env.MODE === "mobile"
  ? lazy(() => import("./mobile"))
  : null;

export default function SignInPage() {
  if (MobileSignInPage) {
    return (
      <Suspense fallback={null}>
        <MobileSignInPage />
      </Suspense>
    );
  }
  if (!DesktopSignInPage) return null;
  return (
    <Suspense fallback={null}>
      <DesktopSignInPage />
    </Suspense>
  );
}
