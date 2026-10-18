import { cn } from "../utils";
export const navigationTreeGroupClass = "grid gap-1";
// Nested rows share the primary navigator row; hierarchy is only a small indent.
export const navigationTreeIndentClass = "ml-3";
export const navigationTreeRowClass = cn(
  "group/tree-row relative",
  navigationTreeIndentClass,
  "flex h-[var(--navigation-row-height,32px)] items-center border-0 p-0",
  "text-[length:var(--navigation-row-font-size,13px)]",
);
// Keep hover feedback paint-only. Transitioning the surface underneath filtered
// brand marks makes WebKit/Chromium repeatedly rasterize them, which looks like
// the glyph is shifting even though its layout box never moves.
export const navigationTreeSurfaceClass = cn(
  "grid h-full min-w-0 flex-1",
  "grid-cols-[var(--navigation-primary-icon-slot,18px)_minmax(0,1fr)]",
  "items-center gap-2.5 rounded-md px-2.5",
  "group-hover/tree-row:bg-charcoal-hover",
  "group-hover/tree-row:text-cream-bright",
  "group-aria-[current=page]/tree-row:bg-charcoal-hover",
  "group-data-[selected=true]/tree-row:bg-charcoal-hover",
);
export const navigationTreeIconClass = cn(
  "pointer-events-none flex size-[var(--navigation-primary-icon-slot,18px)]",
  "shrink-0 items-center justify-center",
  "[&_[data-app-icon]]:!size-[var(--navigation-primary-icon-size,18px)]",
  "[&_svg]:!size-[var(--navigation-primary-icon-size,18px)]",
  "[&_svg]:overflow-visible",
  "[&_img]:!size-[var(--navigation-primary-icon-size,18px)]",
);
export const navigationTreeContentInsetClass = "px-2.5";
export const navigationDisclosureLabelClass = "flex min-w-0 items-center gap-1";
export const navigationDisclosureChevronClass = "shrink-0";

/**
 * The branch beside a nested row (from the old navbar's app tree): a thin trunk that runs
 * through the row and the gap below it, with a straight tick into the row, and on the last
 * row a small rounded corner where the trunk ends. Put it inside a `relative` row and
 * position it with `className` (usually `-left-2`); set --navigation-tree-gap on the list
 * to its row gap so the trunk meets the next row without a seam.
 */
export function TreeBranch(props: {
  className?: string;
  last?: boolean;
  /** Align multi-line rows with their title instead of the row's midpoint. */
  anchor?: number;
  /** Line color; defaults to the muted cream. Tab groups pass their own color. */
  color?: string;
  /** Start the trunk this many pixels above the row, to meet a parent sitting higher. */
  reach?: number;
  /**
   * The row's border width. The branch sits inside the border, so without this the trunk
   * stops short of the row's outer edges and leaves a seam between rows.
   */
  edge?: number;
}) {
  const color = props.color;
  const edge = props.edge ?? 0;
  const top = -(edge + (props.reach ?? 0)) || undefined;
  return (
    <span
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-y-0 w-2", props.className)}
      data-tree-branch="true"
      data-tree-branch-end={props.last ? "true" : undefined}
    >
      {props.last ? (
        <span
          className="absolute top-0 bottom-[calc(50%_-_1px)] left-0 w-full rounded-bl-[3px] border-b border-l border-cream-muted/40"
          style={{
            top,
            borderColor: color,
            ...(props.anchor === undefined ? {} : { height: props.anchor + 1, bottom: "auto" }),
          }}
        />
      ) : (
        <>
          <span
            className="absolute top-0 left-0 w-px bg-cream-muted/40"
            style={{
              top,
              bottom: `calc(-1 * (var(--navigation-tree-gap, 0.25rem) + ${edge}px))`,
              backgroundColor: color,
            }}
          />
          <span
            className="absolute left-0 top-1/2 h-px w-full bg-cream-muted/40"
            style={{
              backgroundColor: color,
              ...(props.anchor === undefined ? {} : { top: props.anchor }),
            }}
          />
        </>
      )}
    </span>
  );
}
