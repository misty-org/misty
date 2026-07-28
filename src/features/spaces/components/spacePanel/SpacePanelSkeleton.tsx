import { Skeleton } from "@/ui";

export function SpacePanelSkeleton() {
  return (
    <div className="grid gap-2" aria-busy="true" role="status">
      <span className="sr-only">Loading Spaces</span>
      <Skeleton className="h-11 rounded-md" />
      <div className="grid grid-cols-5 gap-1.5">
        {[0, 1, 2, 3, 4].map((index) => (
          <Skeleton key={index} className="h-10 rounded-lg" />
        ))}
      </div>
      <Skeleton className="mt-2 h-9 rounded-md" />
      <Skeleton className="h-9 w-4/5 rounded-md" />
      <Skeleton className="h-9 w-3/5 rounded-md" />
    </div>
  );
}
