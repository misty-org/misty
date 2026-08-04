import { lazy, Suspense } from "react";

const DesktopAgentsPage = lazy(() => import("./desktop"));

export default function AgentsPage() {
  return (
    <Suspense fallback={null}>
      <DesktopAgentsPage />
    </Suspense>
  );
}
