import { cn } from "./utils";

export const navigationTreeGroupClass = "grid gap-1";
export const navigationTreeRowClass =
  "group/tree-row relative ml-6 mr-2 flex h-7 items-center text-[13px]";
export const navigationTreeBranchClass = "-left-2";
export const navigationTreeContentInsetClass = "pl-1 pr-2.5";
export const navigationTreeSurfaceClass = `ml-1 flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-md transition-colors ${navigationTreeContentInsetClass}`;
export const navigationTreeIconClass = "grid size-6 shrink-0 place-items-center";
export const navigationTreeItemIconClass = "!size-5";
export const navigationDisclosureLabelClass = "flex min-w-0 items-center gap-1";
export const navigationDisclosureChevronClass = "shrink-0";

export function TreeBranch(props: { className?: string; first?: boolean; last?: boolean }) {
  const topClass = props.first ? "top-0.5" : "-top-0.5";

  return (
    <span
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-y-0 w-3", props.className)}
      data-tree-branch="true"
      data-tree-branch-end={props.last ? "true" : undefined}
    >
      {props.last ? (
        <span
          className={cn(
            "absolute bottom-1/2 left-0 w-3 rounded-bl-[3px] border-b border-l border-charcoal-border/80",
            topClass,
          )}
        />
      ) : (
        <>
          <span
            className={cn("absolute -bottom-0.5 left-0 w-px bg-charcoal-border/80", topClass)}
          />
          <span className="absolute left-0 top-1/2 h-px w-3 bg-charcoal-border/80" />
        </>
      )}
    </span>
  );
}
