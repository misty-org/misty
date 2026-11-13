import { Skeleton, SkeletonControl, Surface } from "@/shared/ui";

/**
 * The canvas standing in until the drawing opens: Excalidraw's floating toolbar over a canvas
 * that fills the pane edge to edge. `header` adds the drawing's title bar above it, for where the
 * drawing itself, and so its header, isn't known yet.
 */
export function DrawingCanvasSkeleton({
  label,
  header = false,
}: {
  label: string;
  header?: boolean;
}) {
  return (
    <Surface
      tone="page"
      role="status"
      aria-label={label}
      aria-busy="true"
      className="relative flex h-full min-h-0 flex-col"
    >
      <span className="sr-only">{label}</span>
      {header ? (
        <div
          className="flex min-h-12 shrink-0 items-center gap-2 border-b py-1.5 pl-1 pr-3"
          aria-hidden="true"
        >
          <SkeletonControl kind="icon" />
          <Skeleton className="h-3.5 w-40" />
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1" aria-hidden="true">
        <Skeleton className="absolute inset-0 rounded-none opacity-40" />
        <Skeleton className="absolute inset-x-0 top-3 mx-auto h-10 w-80 max-w-[80%] rounded-lg" />
      </div>
    </Surface>
  );
}
