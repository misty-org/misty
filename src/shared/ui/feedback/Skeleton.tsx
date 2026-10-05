import { cn } from "../utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("misty-skeleton rounded-md bg-charcoal-card", className)}
      {...props}
    />
  );
}

const titleWidths = ["w-2/3", "w-1/2", "w-3/5", "w-2/5"];

/**
 * Placeholder rows shaped like the list that will replace them. Use instead of
 * "Loading…" text; `label` names what is loading for screen readers.
 */
function SkeletonList({
  label,
  rows = 3,
  leading = "icon",
  lines = 2,
  trailing = false,
  rowClassName,
  className,
}: {
  label: string;
  rows?: number;
  leading?: "icon" | "avatar" | "tile" | "none";
  lines?: 1 | 2;
  trailing?: boolean;
  rowClassName?: string;
  className?: string;
}) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className={cn("grid gap-1", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={cn(
            "flex items-center gap-3",
            lines === 2 ? "min-h-11" : "min-h-8",
            rowClassName,
          )}
        >
          {leading === "icon" && <Skeleton className="size-4 shrink-0 rounded" />}
          {leading === "avatar" && <Skeleton className="size-6 shrink-0 rounded-full" />}
          {leading === "tile" && <Skeleton className="size-8 shrink-0 rounded-lg" />}
          <div className="grid min-w-0 flex-1 gap-1.5">
            <Skeleton className={cn("h-3", titleWidths[index % titleWidths.length])} />
            {lines === 2 && <Skeleton className="h-2.5 w-1/3" />}
          </div>
          {trailing && <Skeleton className="h-7 w-16 shrink-0 rounded-md" />}
        </div>
      ))}
    </div>
  );
}

const lineWidths = ["w-full", "w-11/12", "w-full", "w-4/5", "w-full", "w-2/3"];

/** A document page placeholder for previews and readers. */
function SkeletonDocument({ label, className }: { label: string; className?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className={cn("mx-auto grid w-full max-w-2xl gap-6 px-6 py-10", className)}
    >
      <span className="sr-only">{label}</span>
      <Skeleton className="h-6 w-1/2" />
      {[0, 1, 2].map((paragraph) => (
        <div key={paragraph} className="grid gap-2.5">
          {lineWidths.slice(paragraph, paragraph + 4).map((width, line) => (
            <Skeleton key={line} className={cn("h-3", width)} />
          ))}
        </div>
      ))}
    </div>
  );
}

export { Skeleton, SkeletonDocument, SkeletonList };
