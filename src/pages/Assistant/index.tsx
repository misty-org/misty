import { lazy, Suspense } from "react";

const DesktopAssistantPage = lazy(() => import("./desktop"));

export default function AssistantPage() {
  return (
    <Suspense fallback={null}>
      <DesktopAssistantPage />
    </Suspense>
  );
}
