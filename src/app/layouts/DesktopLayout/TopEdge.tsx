import { cn, Surface, windowToolbarClass } from "@misty/ui";
import { barHeight, closedHeight, openHeight } from "./space_bar_timing";
import { useWindowButtonsOnBar } from "./use_window_buttons_on_bar";

export function TopEdge(props: { gridColumn: number; side?: "left" | "right" }) {
  const holdsWindowButtons = props.side === "right";
  useWindowButtonsOnBar(holdsWindowButtons, true);
  return (
    <Surface
      tone="chrome"
      className="relative min-w-0 overflow-visible"
      style={{
        gridColumn: props.gridColumn,
        gridRow: 1,
        height: holdsWindowButtons ? openHeight : closedHeight,
      }}
    >
      {holdsWindowButtons ? (
        <div className="flex h-full flex-col justify-end overflow-hidden">
          <Surface
            tone="tab-well"
            edge="hairline"
            radius="lg"
            className={cn(
              "mb-0 mt-[var(--shell-edge,calc(var(--spacing)*1.5))] shrink-0 overflow-hidden",
              props.side === "right"
                ? "ml-[var(--shell-edge,calc(var(--spacing)*1.5))] mr-[var(--shell-gap,var(--spacing))]"
                : "ml-[var(--shell-gap,var(--spacing))] mr-[var(--shell-edge,calc(var(--spacing)*1.5))]",
            )}
            style={{ height: barHeight }}
            data-misty-window-titlebar-region="true"
          >
            <div
              className={cn(
                "h-full min-w-0",
                windowToolbarClass,
                "data-[window-chrome=true]:!pl-[max(0px,calc(var(--window-chrome-left,0px)_-_var(--spacing)_*_4))]",
              )}
              data-window-toolbar=""
            />
          </Surface>
        </div>
      ) : null}
    </Surface>
  );
}
