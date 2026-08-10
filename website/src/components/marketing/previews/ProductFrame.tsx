import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function ProductFrame({
  title,
  meta,
  children,
  className,
}: {
  title: string;
  meta?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "gap-0 overflow-hidden rounded-none py-0 shadow-none",
        className,
      )}
    >
      <div className="flex h-12 items-center justify-between border-b border-border px-4 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-foreground">{title}</span>
        </div>
        {meta ? (
          <span className="text-xs text-muted-foreground">{meta}</span>
        ) : null}
      </div>
      {children}
    </Card>
  );
}
