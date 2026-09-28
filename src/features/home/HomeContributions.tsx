import { cn } from "@/shared/ui";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { contributionDates, dateKey, type HomeActivity } from "./homeActivity";

export const contributionWeeks = 40;
export const contributionDays = contributionWeeks * 7;

/** Visit heatmap shared by the global Home page and each Space's home. */
export function OverviewContributions(props: { dates: Date[]; activity: HomeActivity }) {
  return (
    <div className="min-w-0 pb-1 [container-type:inline-size]">
      <div className="min-w-0">
        <div
          className="mb-1.5 flex justify-between px-0.5 text-[10px] text-cream-muted"
          aria-hidden="true"
        >
          {monthLabels(props.dates).map((label) => (
            <span key={label.key}>{label.label}</span>
          ))}
        </div>
        <div
          className="grid min-w-0 grid-flow-col grid-rows-[repeat(7,auto)] auto-cols-fr place-items-center gap-[clamp(0.125rem,0.25cqw,0.25rem)]"
          aria-label={`${contributionWeeks} weeks of Home activity`}
        >
          {props.dates.map((date) => {
            const key = dateKey(date);
            const count = props.activity[key] ?? 0;
            return (
              <span
                key={key}
                className={cn(
                  "aspect-square w-full max-w-[clamp(1.125rem,1.4cqw,1.5rem)] rounded-[5px]",
                  contributionClass(count),
                )}
                title={`${count} ${count === 1 ? "visit" : "visits"} on ${date.toLocaleDateString()}`}
              />
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-cream-muted">
          <span>Less</span>
          {[0, 1, 2, 4].map((count) => (
            <span key={count} className={cn("size-2.5 rounded-[3px]", contributionClass(count))} />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
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
function monthLabels(dates: Date[]): {
  key: string;
  label: string;
}[] {
  const labels: {
    key: string;
    label: string;
  }[] = [];
  for (const date of dates) {
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (labels.some((label) => label.key === key)) continue;
    labels.push({
      key,
      label: new Intl.DateTimeFormat(undefined, {
        month: "short",
      }).format(date),
    });
  }
  return labels;
}
