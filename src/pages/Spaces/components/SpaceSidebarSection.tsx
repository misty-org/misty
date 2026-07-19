import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SpaceSidebarSection({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("grid gap-1", className)}>
      {title || action ? (
        <div className="mb-1 flex min-h-6 items-center gap-2 px-2">
          {title ? <h2 className="m-0 min-w-0 flex-1 truncate text-[10px] font-semibold text-muted-foreground">{title}</h2> : <span className="flex-1"/>}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}
