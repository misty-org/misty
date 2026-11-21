import { cn, Surface, windowToolbarClass } from "@misty/ui";
import { barHeight, closedHeight, openHeight } from "./spaceBarTiming";
import { useWindowButtonsOnBar } from "./useWindowButtonsOnBar";

/**
 * The strip above the pages. With tabs on the left it is only the window edge, which keeps the
 * page's top margin. With tabs on the right no sidebar sits under the window buttons, so they sit
 * in an empty bar here and keep it from being laid over the page.
 */
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
            // The window edge above and on its outer side, the gap toward the sidebar.
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
                // The bar's own padding and the card's margin already count toward the room the
                // window buttons need.
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
