import type { ReactNode } from "react";
import { cn, Surface } from "@misty/ui";
import { useSidebarPlaceColor } from "./sidebar_place_color";

export function SidebarAccountBar(props: {
  side: "left" | "right";
  above?: ReactNode;
  children: ReactNode;
}) {
  const placeColor = useSidebarPlaceColor();
  const left = props.side === "left";
  return (
    <Surface
      tone="chrome"
      className={cn(
        "flex shrink-0",
        left
          ? "pl-[var(--pane-frame,calc(var(--spacing)*1.5))]"
          : "pr-[var(--pane-frame,calc(var(--spacing)*1.5))]",
      )}
    >
      <Surface
        tone="sidebar"
        place={placeColor}
        className={cn("flex min-w-0 flex-1 flex-col pt-2 pb-6", left ? "pr-3 pl-2" : "px-3")}
        data-misty-window-drag-block="true"
      >
        {props.above}
        {props.children}
      </Surface>
    </Surface>
  );
}
