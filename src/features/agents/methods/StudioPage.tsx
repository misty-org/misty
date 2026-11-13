import type { ReactNode } from "react";
import { cn, Surface } from "@/shared/ui";

/**
 * A page the Agents sidebar opens beside the chats (integrations, notebooks), after Polar's: the
 * page's own fill, running the canvas's full height, in the controls' type.
 */
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

/**
 * The scroller inside a StudioPage. Its gutter is kept, so content that grows past the fold never
 * narrows the page and shifts it sideways.
 */
export function StudioPageScroll({ children }: { children: ReactNode }) {
  return <div className="min-w-0 flex-1 overflow-auto [scrollbar-gutter:stable]">{children}</div>;
}
