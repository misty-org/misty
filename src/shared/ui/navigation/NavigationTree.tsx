import { cn } from "../utils";

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
