import { ChevronRight } from "lucide-react";
import * as React from "react";
import { cn } from "../classNames";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../overlays/DropdownMenu";
import { SearchablePicker, type SearchablePickerProps } from "../overlays/SearchablePicker";
import { renderIcon, type IconSource } from "./ActionBar";
import { OverflowFadeText } from "./OverflowFadeText";

export type PathLineSegment = {
  /** Stable key; defaults to the segment's position. */
  id?: string;
  icon?: IconSource;
  label: string;
  /** Menu rows opened from the segment, e.g. a few choices to switch to. */
  menu?: React.ReactNode;
  /**
   * A searchable list opened from the segment instead of a menu, for a long list such as the
   * branches to switch to.
   */
  picker?: PathLinePicker;
};

/** A SearchablePicker opened from a path line segment, which is its trigger. */
export type PathLinePicker = Omit<
  SearchablePickerProps,
  "label" | "icon" | "placeholder" | "trigger" | "side" | "align" | "size" | "variant" | "className"
> & {
  /** The list's name, e.g. "Branch". Defaults to the segment's label. */
  label?: string;
};

export type PathLineProps = {
  segments: ReadonlyArray<PathLineSegment>;
  /** Accessible name, e.g. "Where this chat works". */
  label?: string;
  /** Layout only: margins or placement. */
  className?: string;
};

/** No label fades away entirely; past this the line clips at its edge. */
const minLabelPx = 24;

/**
 * The widest any label may be so that every label fits in `available`, cutting the longest first:
 * the longest shortens down to the next longest, then both shorten together, and so on. Returns
 * null when everything fits as it is.
 */
export function pathLineLabelCap(natural: ReadonlyArray<number>, available: number): number | null {
  const total = natural.reduce((sum, width) => sum + width, 0);
  if (total <= available) return null;
  const sorted = [...natural].sort((a, b) => a - b);
  let kept = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const cap = (available - kept) / (sorted.length - index);
    if (cap < sorted[index]) return Math.max(minLabelPx, Math.floor(cap));
    kept += sorted[index];
  }
  return null;
}

const segmentClass = cn(
  "flex min-w-0 shrink-0 items-center gap-1 rounded-sm",
  "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
);

/** A segment that opens a menu or a picker. */
const openerClass = cn(
  segmentClass,
  "h-6 px-1 outline-none hover:bg-control-hover hover:text-cream",
  // Focus rings are off app-wide, so keyboard focus shows as the hover wash.
  "focus-visible:bg-control-hover focus-visible:text-cream",
  "data-[state=open]:bg-control-active data-[state=open]:text-cream",
);

/**
 * Where something works, as one quiet line: "Space › folder › branch" under the composer. Each
 * segment fades instead of wrapping, and the longest name shortens first. Segments with a menu
 * or a picker open it, like a branch switcher. The line is sans; paths are never set in monospace here.
 */
export function PathLine({ segments, label, className }: PathLineProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [cap, setCap] = React.useState<number | null>(null);
  const labelKey = segments.map((segment) => segment.label).join("\n");

  const measure = React.useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const width = root.getBoundingClientRect().width;
    if (width === 0) return;
    const labels = Array.from(root.querySelectorAll<HTMLElement>("[data-path-label]"));
    // A label's scrollWidth is its full text however it is capped; everything else in the line
    // (icons, separators, gaps) keeps its width whatever the cap is.
    const natural = labels.map((element) => element.scrollWidth);
    const shown = labels.reduce((sum, element) => sum + element.getBoundingClientRect().width, 0);
    const children = Array.from(root.children) as HTMLElement[];
    const used = children.reduce((sum, element) => sum + element.getBoundingClientRect().width, 0);
    const gap = Number.parseFloat(getComputedStyle(root).columnGap) || 0;
    const fixed = used - shown + Math.max(0, children.length - 1) * gap;
    const next = pathLineLabelCap(natural, width - fixed);
    setCap((value) => (value === next ? value : next));
  }, []);

  React.useLayoutEffect(() => {
    measure();
  }, [measure, labelKey]);

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure]);

  const labelStyle = cap === null ? undefined : { maxWidth: cap };

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={label}
      data-slot="path-line"
      className={cn(
        "flex h-6 min-w-0 items-center gap-1 overflow-hidden font-sans text-meta text-cream-muted",
        className,
      )}
    >
      {segments.map((segment, index) => {
        const body = (
          <>
            {renderIcon(segment.icon)}
            <OverflowFadeText
              data-path-label=""
              full
              style={labelStyle}
            >
              {segment.label}
            </OverflowFadeText>
          </>
        );
        return (
          <React.Fragment key={segment.id ?? index}>
            {index > 0 ? (
              <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-cream-muted" />
            ) : null}
            {segment.picker ? (
              <SearchablePicker
                {...segment.picker}
                label={segment.picker.label ?? segment.label}
                side="top"
                align="start"
                trigger={
                  <button type="button" className={openerClass}>
                    {body}
                  </button>
                }
              />
            ) : segment.menu ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={openerClass}>
                    {body}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top">
                  {segment.menu}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className={segmentClass}>{body}</span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
