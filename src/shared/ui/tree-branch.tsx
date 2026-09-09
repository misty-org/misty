import { cn } from "./utils";

export const navigationTreeGroupClass =
  "grid [--navigation-tree-gap:0.125rem] gap-[var(--navigation-tree-gap)]";
export const navigationTreeRowClass =
  "group/tree-row relative ml-[27px] mr-2 flex h-7 items-center border-0 p-0 text-[13px]";
// Parent icon center: 10px header padding + half its 18px icon = 19px.
// The child row starts at 27px; its branch sits 8px to the left.
export const navigationPrimaryRowLayoutClass =
  "grid grid-cols-[28px_minmax(0,1fr)] items-center gap-2.5";
export const navigationTreeBranchClass = "-left-2";
// Anchor to the expanded grid row, outside the animated content's clipping box,
// so the rail can cross the gap before the next sibling.
export const navigationTreeContinuationClass =
  "pointer-events-none absolute left-[19px] row-start-2 row-end-3 top-0 -bottom-[var(--navigation-tree-gap,0.25rem)] w-px bg-cream-muted/40";
export const navigationTreeContentInsetClass = "px-2";
// Keep hover feedback paint-only. Transitioning the surface underneath filtered
// brand marks makes WebKit/Chromium repeatedly rasterize them, which looks like
// the glyph is shifting even though its layout box never moves.
export const navigationTreeSurfaceClass = `ml-1 grid h-full min-w-0 flex-1 grid-cols-[20px_minmax(0,1fr)] items-center gap-2 rounded-md ${navigationTreeContentInsetClass} group-hover/tree-row:bg-charcoal-card group-aria-[current=page]/tree-row:bg-charcoal-active group-data-[selected=true]/tree-row:bg-charcoal-active`;
export const navigationTreeIconClass =
  "pointer-events-none grid size-5 shrink-0 place-items-center [transform:translateZ(0)] [backface-visibility:hidden] [&_svg]:!size-[18px] [&_svg]:overflow-visible [&_img]:!size-[18px]";
export const navigationTreeItemIconClass = "block !size-5 shrink-0 overflow-visible";
export const navigationDisclosureLabelClass = "flex min-w-0 items-center gap-1";
export const navigationDisclosureChevronClass = "shrink-0";

export function TreeBranch(props: {
  className?: string;
  first?: boolean;
  last?: boolean;
  /** Align multi-line rows with their title instead of the whole row's midpoint. */
  anchor?: number;
}) {
  return (
    <span
      aria-hidden="true"
      // The branch starts 8px before the row. Stop at its edge, leaving the
      // surface's inset clear in navigation, Settings, and Explorer alike.
      className={cn("pointer-events-none absolute inset-y-0 w-2", props.className)}
      data-tree-branch="true"
      data-tree-branch-end={props.last ? "true" : undefined}
    >
      {props.last ? (
        <span
          className="absolute top-0 bottom-[calc(50%_-_1px)] left-0 w-full rounded-bl-[3px] border-b border-l border-cream-muted/40"
          style={
            props.anchor === undefined ? undefined : { height: props.anchor + 1, bottom: "auto" }
          }
        />
      ) : (
        <>
          {/* Extend through the entire grid gap to meet the next row without
              overlapping translucent strokes or leaving border-sized seams. */}
          <span className="absolute top-0 -bottom-[var(--navigation-tree-gap,0.25rem)] left-0 w-px bg-cream-muted/40" />
          <span
            className="absolute left-0 top-1/2 h-px w-full bg-cream-muted/40"
            style={props.anchor === undefined ? undefined : { top: props.anchor }}
          />
        </>
      )}
    </span>
  );
}
