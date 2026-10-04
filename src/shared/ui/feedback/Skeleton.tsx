import { cn } from "../utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-md bg-charcoal-card motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
