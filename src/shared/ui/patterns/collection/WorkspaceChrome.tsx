import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../utils";

/** Shared geometry for tool navigation and collection workspaces. */
export function WorkspaceSidebar({ className, ...props }: ComponentProps<"aside">) {
  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-56 shrink-0 flex-col gap-2 overflow-y-auto border-r",
        "border-charcoal-border bg-charcoal-sidebar p-2 misty-transient-scrollbar",
        className,
      )}
      {...props}
    />
  );
}

export function WorkspaceSectionLabel({
  children,
  actions,
  compact = false,
  className,
}: {
  children: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-6 items-center justify-between gap-2 px-2",
        // The label sits tight on the list it names; the space above separates the sections.
        !compact && "mt-4",
        className,
      )}
    >
      {/* Sidebar titles read lighter than the muted rows beneath them. */}
      <h2 className={cn("text-xs font-medium", compact ? "text-cream-muted" : "text-cream")}>
        {children}
      </h2>
      {actions}
    </div>
  );
}
