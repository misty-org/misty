import { cn } from "@/ui";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-charcoal-card", className)}
      {...props}
    />
  );
}

export { Skeleton };
