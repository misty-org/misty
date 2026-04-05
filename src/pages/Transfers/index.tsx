import { lazy, Suspense } from "react";

const DesktopTransfersPage = lazy(() => import("./desktop"));

export default function TransfersPage() {
  return (
    <Suspense fallback={null}>
      <DesktopTransfersPage />
    </Suspense>
  );
}
