import { lazy, Suspense } from "react";
import { detectAppFormFactor } from "../../platform/formFactor";
import MobileSettingsPage from "./mobile";

const DesktopSettingsPage = import.meta.env.MODE === "mobile"
  ? null
  : lazy(() => import("./desktop"));

export default function SettingsPage() {
  if (detectAppFormFactor() === "mobile" || !DesktopSettingsPage) return <MobileSettingsPage />;
  return (
    <Suspense fallback={null}>
      <DesktopSettingsPage />
    </Suspense>
  );
}
