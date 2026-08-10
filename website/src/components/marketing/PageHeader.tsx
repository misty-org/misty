import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageHeader({
  label,
  title,
  description,
  action,
  className,
}: {
  label: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "grid gap-8 border-b border-border pb-12 md:grid-cols-[1fr_auto] md:items-end",
        className,
      )}
    >
      <div className="max-w-3xl">
        <p className="mb-5 text-sm text-muted-foreground">{label}</p>
        <h1 className="text-balance text-4xl font-medium leading-[1.02] tracking-[-0.045em] text-foreground sm:text-5xl lg:text-6xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div>{action}</div> : null}
    </header>
  );
}
