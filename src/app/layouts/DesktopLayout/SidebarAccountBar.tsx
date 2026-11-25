import type { ReactNode } from "react";
import { cn, Separator, Surface } from "@misty/ui";
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
        "flex shrink-0 flex-col",
        left
          ? "pl-[var(--pane-frame,calc(var(--spacing)*1.5))]"
          : "pr-[var(--pane-frame,calc(var(--spacing)*1.5))]",
      )}
    >
      <Separator />
      <Surface
        tone="sidebar"
        place={placeColor}
        className={cn(
          "flex min-w-0 flex-1 flex-col py-3",
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
