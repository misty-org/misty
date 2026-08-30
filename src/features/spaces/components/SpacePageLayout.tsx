import { cn } from "@/shared/ui";
import type { HTMLAttributes, ReactNode } from "react";

export function SpacePageFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-charcoal-bg text-cream",
        className,
      )}
    >
      <SpacePageBody>{children}</SpacePageBody>
    </div>
  );
}

export function SpacePageBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("min-h-0 min-w-0 flex-1 overflow-hidden bg-charcoal-bg p-0", className)}
      {...props}
    />
  );
}
