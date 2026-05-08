import { lazy, Suspense } from "react";

const CodingWorkspace = lazy(() =>
  import("@/features/coding-workspace/CodingWorkspace").then((module) => ({
    default: module.CodingWorkspace,
  })),
);

export function DeveloperWorkspace() {
  return (
    <Suspense
      fallback={
        <div className="grid h-full place-items-center bg-charcoal-workspace text-xs text-cream-muted">
          Loading Code…
        </div>
      }
    >
      <CodingWorkspace />
    </Suspense>
  );
}
