import type { LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { cn } from "../classNames";

export type StarterPrompt = {
  /** What the idea is, in a few words: the row's label. */
  label: string;
  icon: LucideIcon;
  /** What goes into the composer when it is picked, left for the person to finish and send. */
  prompt: string;
};

/**
 * Ideas to start from under an empty chat, for someone who doesn't know what to ask yet: quiet
 * rows of an icon and a label in two columns as wide as their labels, the whole block centered
 * under the heading. It drops to one column before a label would be cut.
 * Picking one hands its prompt to the caller, which puts it in the composer unsent.
 *
 * `variant="chips"` lays them out instead as one centered row of pills, for under a composer.
 *
 * ```tsx
 * <StarterPrompts label="Ideas to start with" prompts={ideas} onPick={(p) => setQuery(p.prompt)} />
 * ```
 */
export function StarterPrompts({
  label,
  prompts,
  onPick,
  className,
  variant = "rows",
}: {
  /** The list's accessible name. */
  label: string;
  prompts: readonly StarterPrompt[];
  onPick(prompt: StarterPrompt): void;
  className?: string;
  variant?: "rows" | "chips";
}) {
  if (variant === "chips") {
    return <StarterChips label={label} prompts={prompts} onPick={onPick} className={className} />;
  }
  return (
    <div data-slot="starter-prompts" className={cn("@container/starter", className)}>
      <ul
        aria-label={label}
        className="mx-auto grid w-fit grid-cols-[max-content] gap-x-6 gap-y-1 @md/starter:grid-cols-[repeat(2,max-content)]"
      >
        {prompts.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.label} className="min-w-0">
              <button
                type="button"
                onClick={() => onPick(item)}
                className={cn(
                  "flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md px-3 text-left",
                  "text-control text-cream outline-none transition-colors",
                  "hover:bg-control-hover hover:text-cream-bright",
                  "focus-visible:bg-control-hover focus-visible:text-cream-bright",
                )}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0 text-cream-muted" />
                <span className="min-w-0 whitespace-nowrap">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * One row of pills that never wraps: the prompts are in priority order, and the ones that would
 * start a second row are left out (not cut, not scrolled) until there is room again.
 */
function StarterChips({
  label,
  prompts,
  onPick,
  className,
}: {
  label: string;
  prompts: readonly StarterPrompt[];
  onPick(prompt: StarterPrompt): void;
  className?: string;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const fit = () => {
      const items = [...list.children] as HTMLElement[];
      for (const item of items) item.hidden = false;
      const top = items[0]?.offsetTop ?? 0;
      for (const item of items) item.hidden = item.offsetTop > top;
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(list);
    return () => observer.disconnect();
  }, [prompts]);
  return (
    <div data-slot="starter-prompts" data-variant="chips" className={className}>
      <ul
        ref={listRef}
        aria-label={label}
        className="flex flex-wrap justify-center gap-2 overflow-hidden"
      >
        {prompts.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.label} className="shrink-0">
              <button
                type="button"
                onClick={() => onPick(item)}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full border border-charcoal-border px-3",
                  "text-control text-cream outline-none transition-colors",
                  "hover:border-charcoal-border-strong hover:bg-control-hover hover:text-cream-bright",
                  "focus-visible:border-charcoal-border-strong focus-visible:bg-control-hover focus-visible:text-cream-bright",
                )}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0 text-cream-muted" />
                <span className="whitespace-nowrap">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
