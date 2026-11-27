import type { ReactNode } from "react";
import { cn, Surface } from "@misty/ui";

export function SidebarAccountBar(props: {
  side: "left" | "right";
  above?: ReactNode;
  children: ReactNode;
}) {
  const left = props.side === "left";
  return (
    <Surface
      tone="chrome"
      className={cn(
        "flex shrink-0 flex-col",
        left
          ? "pl-[var(--pane-frame,calc(var(--spacing)*1.5))]"
          : "pr-[var(--pane-frame,calc(var(--spacing)*1.5))]",
      )}
    >
      <Surface
        tone="chrome"
        className={cn(
          "flex min-w-0 flex-1 flex-col justify-end pt-2 pb-[calc(var(--spacing)*2+var(--pane-frame,calc(var(--spacing)*1.5)))]",
          left
            ? "pl-2 pr-[calc(var(--spacing)*2+var(--pane-frame,calc(var(--spacing)*1.5)))]"
            : "pr-2 pl-[calc(var(--spacing)*2+var(--pane-frame,calc(var(--spacing)*1.5)))]",
        )}
        data-misty-window-drag-block="true"
      >
        {props.above}
        {props.children}
      </Surface>
    </Surface>
  );
}
