import type { LucideIcon } from "lucide-react";
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
 * rows of an icon and a label in a centered grid that drops a column before a label would be
 * cut.
 * Picking one hands its prompt to the caller, which puts it in the composer unsent.
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
}: {
  /** The list's accessible name. */
  label: string;
  prompts: readonly StarterPrompt[];
  onPick(prompt: StarterPrompt): void;
  className?: string;
}) {
  return (
    <ul
      aria-label={label}
      data-slot="starter-prompts"
      className={cn("grid grid-cols-[repeat(auto-fit,14rem)] justify-center gap-1", className)}
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
  );
}
