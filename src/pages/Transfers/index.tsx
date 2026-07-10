import { lazy, Suspense } from "react";
import { detectAppFormFactor } from "../../platform/formFactor";
import MobileTransfersPage from "./mobile";

const DesktopTransfersPage = import.meta.env.MODE === "mobile"
  ? null
  : lazy(() => import("./desktop"));

export default function TransfersPage() {
  if (detectAppFormFactor() === "mobile" || !DesktopTransfersPage) return <MobileTransfersPage />;
  return (
    <Suspense fallback={null}>
      <DesktopTransfersPage />
    </Suspense>
  );
}
