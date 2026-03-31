import { lazy, Suspense } from "react";
import { detectAppFormFactor } from "../../platform/formFactor";
import MobileAccountPage from "./mobile";

const DesktopAccountPage = import.meta.env.MODE === "mobile"
  ? null
  : lazy(() => import("./desktop"));

export default function AccountPage() {
  if (detectAppFormFactor() === "mobile" || !DesktopAccountPage) return <MobileAccountPage />;
  return (
    <Suspense fallback={null}>
      <DesktopAccountPage />
    </Suspense>
  );
}
