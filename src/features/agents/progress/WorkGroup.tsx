import { cn, OverflowFadeText, Pressable, Text } from "@/shared/ui";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Sent to a closed fold that holds the chat search's current match, so it opens (`timelineSearch.ts`). */
export const REVEAL_FOLD_EVENT = "misty-reveal-fold";

/** Height animates open and closed; closed content leaves the tab order. */
export function Fold({
  id,
  open,
  onReveal,
  children,
}: {
  id: string;
  open: boolean;
  /** Opens the fold when search lands on something inside it. */
  onReveal?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !onReveal) return;
    element.addEventListener(REVEAL_FOLD_EVENT, onReveal);
    return () => element.removeEventListener(REVEAL_FOLD_EVENT, onReveal);
  }, [onReveal]);
  return (
    <div
      ref={ref}
      id={id}
      // `agent-progress-fold` is the chat search's hook (`timelineSearch.ts`).
      className={cn(
        "agent-progress-fold grid grid-rows-[0fr] transition-[grid-template-rows] duration-[220ms]",
        "data-[open]:grid-rows-[1fr] motion-reduce:transition-none",
      )}
      data-open={open || undefined}
      inert={!open}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/** A small drawn chevron that points right while folded and down while open. */
export function Chevron({ open = false }: { open?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mx-0.5 size-2 shrink-0 border-r-[1.5px] border-b-[1.5px] border-current",
        "transition-transform duration-200 motion-reduce:transition-none",
        open ? "-translate-y-0.5 rotate-45" : "-rotate-45",
      )}
    />
  );
}

/**
 * One muted line with a chevron that opens to what is under it. It shimmers
 * while its work runs (only the outermost line does: `shimmer` turns it off for nested ones); unless the person chose, it is open while running (or
 * from the start with `openAtStart`) and folds once it finishes.
 */
export function WorkGroup({
  summary,
  running,
  openAtStart,
  autoOpen = true,
  shimmer = running,
  children,
}: {
  summary: ReactNode;
  running: boolean;
  openAtStart?: boolean;
  /** Opens by itself while running; false keeps it folded until the person opens it. */
  autoOpen?: boolean;
  /** Whether the line shimmers; defaults to running. */
  shimmer?: boolean;
  children: ReactNode;
}) {
  const [chosen, setChosen] = useState<boolean>();
  const open = chosen ?? (openAtStart || (autoOpen && running));
  const listId = useId();
  return (
    <div data-open={open || undefined}>
      {/* Muted at rest; the text wash brightens it under the pointer. */}
      <Text bare tone="muted">
        <Pressable
          wash="text"
          className="inline-flex max-w-full items-center gap-1.5 py-1.5 pr-2 pl-px text-meta leading-5"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setChosen(!open)}
        >
          <OverflowFadeText className={shimmer ? "misty-shimmer" : undefined} aria-live="polite">
            {summary}
          </OverflowFadeText>
          <Chevron open={open} />
        </Pressable>
      </Text>
      <Fold id={listId} open={open} onReveal={() => setChosen(true)}>
        {children}
      </Fold>
    </div>
  );
}
