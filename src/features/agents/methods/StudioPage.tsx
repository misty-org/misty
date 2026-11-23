import type { ReactNode } from "react";
import { cn, Surface } from "@misty/ui";

export function StudioPage({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Surface
      tone="page"
      className={cn("flex h-full min-h-0 overflow-hidden text-control leading-normal", className)}
    >
      {children}
    </Surface>
  );
}

export function StudioPageScroll({ children }: { children: ReactNode }) {
  return <div className="min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]">{children}</div>;
}
