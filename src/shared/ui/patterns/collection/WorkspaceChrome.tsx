import type { ComponentProps } from "react";
import { cn } from "../../classNames";

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
