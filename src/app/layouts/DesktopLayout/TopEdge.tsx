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
    <div
      className="relative min-w-0 overflow-visible bg-[var(--misty-window-chrome,var(--misty-theme-workspace))]"
      style={{
        gridColumn: props.gridColumn,
        gridRow: 1,
        height: holdsWindowButtons ? openHeight : closedHeight,
      }}
    >
      {holdsWindowButtons ? (
        <div className="flex h-full flex-col justify-end overflow-hidden">
          <div
            className={
              "misty-space-bar-card shrink-0 overflow-hidden " +
              "rounded-lg border border-charcoal-border bg-[var(--workspace-tab-surface)]"
            }
            style={{ height: barHeight }}
            data-misty-window-titlebar-region="true"
          >
            <div className="h-full min-w-0" data-window-toolbar="" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
