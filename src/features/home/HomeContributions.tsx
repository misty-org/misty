import { cn } from "@/shared/ui";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { contributionDates, dateKey, type HomeActivity } from "./homeActivity";

export const contributionWeeks = 40;
const fillGap = 4;

/**
 * The heatmap sized to its container: cells fill the full height, and as many weeks as fit
 * across the width are shown, so a wider panel shows more history rather than empty space.
 */
export function FillContributions(props: { now: Date; activity: HomeActivity }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [weeks, setWeeks] = useState(contributionWeeks);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const cell = (height - fillGap * 6) / 7;
      if (cell <= 0 || width <= 0) return;
      setWeeks(Math.max(8, Math.min(104, Math.floor((width + fillGap) / (cell + fillGap)))));
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);
  const dates = useMemo(() => contributionDates(props.now, weeks * 7), [props.now, weeks]);
  const months = dates.flatMap((date, index) =>
    index % 7 === 0 && (index === 0 || date.getMonth() !== dates[index - 7].getMonth())
      ? [{ week: index / 7, date }]
      : [],
  );
  const columns = { gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` };
  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="grid text-[10px] text-cream-muted" style={columns} aria-hidden="true">
        {months.map(({ week, date }) => (
          <span key={week} className="truncate" style={{ gridColumnStart: week + 1 }}>
            {new Intl.DateTimeFormat(undefined, { month: "short" }).format(date)}
          </span>
        ))}
      </div>
      <div
        ref={gridRef}
        className="grid min-h-0 flex-1 grid-flow-col"
        style={{ ...columns, gridTemplateRows: "repeat(7, minmax(0, 1fr))", gap: fillGap }}
        aria-label={`${weeks} weeks of Home activity`}
      >
        {dates.map((date) => {
          const count = props.activity[dateKey(date)] ?? 0;
          return (
            <span
              key={dateKey(date)}
              className={cn("rounded-[4px]", contributionClass(count))}
              title={`${count} ${count === 1 ? "visit" : "visits"} on ${date.toLocaleDateString()}`}
            />
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-1.5 text-[10px] text-cream-muted">
        <span>Less</span>
        {[0, 1, 2, 4].map((count) => (
          <span key={count} className={cn("size-2.5 rounded-[3px]", contributionClass(count))} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

function contributionClass(count: number): string {
  if (count >= 4) return "bg-cream-bright";
  if (count >= 2) return "bg-cream-bright/70";
  if (count >= 1) return "bg-cream-bright/40";
  return "bg-charcoal-active/75";
}
