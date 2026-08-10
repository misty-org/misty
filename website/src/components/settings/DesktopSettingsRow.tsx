import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function DesktopSettingsRow({
  label,
  description,
  children,
  last,
  muted,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  last?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid min-h-16 grid-cols-[minmax(0,0.52fr)_minmax(240px,0.48fr)] items-center gap-5 border-b border-border px-5 py-3.5 last:border-b-0",
        "max-[760px]:grid-cols-1 max-[760px]:items-start max-[760px]:gap-3",
        "max-[520px]:grid-cols-1",
        last && "border-b-0",
        muted && "opacity-50",
      )}
    >
      <div className="grid min-w-0 gap-1">
        <strong className="text-sm font-medium leading-5 text-foreground">{label}</strong>
        {description ? (
          <span className="text-sm leading-5 text-muted-foreground">{description}</span>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center justify-end max-[760px]:w-full max-[760px]:justify-start">
        {children}
      </div>
    </div>
  );
}
