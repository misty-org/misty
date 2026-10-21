import { cn, Pressable } from "@/shared/ui";
import type { LucideIcon } from "lucide-react";
export interface DesktopSettingsNavEntry<Id extends string = string> {
  id: Id;
  label: string;
  icon?: LucideIcon;
}
export interface DesktopSettingsNavGroup<Id extends string = string> {
  /** A plain muted label naming the feature the pages belong to. */
  label: string;
  items: readonly DesktopSettingsNavEntry<Id>[];
}
/**
 * Pages under plain group labels, one row per page: an icon and the name. No disclosures,
 * chevrons or dividers.
 */
export function SettingsNavigation<Id extends string>(props: {
  groups: readonly DesktopSettingsNavGroup<Id>[];
  activeId: Id;
  label: string;
  onSelect: (id: Id) => void;
}) {
  return (
    <nav
      aria-label={props.label}
      className={cn(
        "misty-scrollbar min-h-0 flex-1 overflow-y-auto pl-3 pr-[max(0px,calc(0.75rem-var(--misty-scrollbar-size)))]",
        "[scrollbar-gutter:stable] max-[680px]:pl-2 max-[680px]:pr-[max(0px,calc(0.5rem-var(--misty-scrollbar-size)))]",
      )}
    >
      {props.groups.map((group) => (
        <div key={group.label} role="group" aria-label={group.label} className="pb-3">
          <p className="px-2.5 pb-1.5 pt-2 text-[13px] leading-5 text-cream-muted">{group.label}</p>
          <div className="grid gap-0.5">
            {group.items.map((entry) => {
              const Icon = entry.icon;
              const active = props.activeId === entry.id;
              return (
                <Pressable
                  key={entry.id}
                  aria-current={active ? "page" : undefined}
                  data-settings-nav-entry={entry.id}
                  data-misty-window-drag-block="true"
                  className={cn(
                    "flex h-9 w-full min-w-0 items-center gap-3 rounded-lg px-2.5 text-left text-[15px] leading-5",
                    "transition-colors",
                    active
                      ? "bg-charcoal-hover text-cream-bright"
                      : "text-cream hover:bg-charcoal-hover/60",
                  )}
                  onClick={() => props.onSelect(entry.id)}
                >
                  {Icon ? (
                    <Icon
                      aria-hidden
                      strokeWidth={1.75}
                      className={cn("size-[18px] shrink-0", !active && "text-cream-muted")}
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                </Pressable>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
