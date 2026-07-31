import { Skeleton } from "@/ui";

export function SpacePanelSkeleton() {
  return (
    <div className="grid gap-2" aria-busy="true" role="status">
      <span className="sr-only">Loading Spaces</span>
      <Skeleton className="h-5 w-24 rounded-md" />
      <Skeleton className="h-10 rounded-md" />
      <Skeleton className="h-10 w-5/6 rounded-md" />
      <Skeleton className="h-10 w-4/5 rounded-md" />
    </div>
  );
}
