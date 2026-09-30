import { cn, NavigationSectionButton } from "@/shared/ui";
import type { LucideIcon } from "lucide-react";
import { Fragment } from "react";
export interface DesktopSettingsNavEntry<Id extends string = string> {
  id: Id;
  label: string;
  icon?: LucideIcon;
  hasSections?: boolean;
  breakBefore?: boolean;
}
/** The incumbent navigation chrome, with one destination per area and no disclosures. */
export function SettingsNavigation<Id extends string>(props: {
  items: readonly DesktopSettingsNavEntry<Id>[];
  activeId: Id;
  label: string;
  onSelect: (id: Id) => void;
}) {
  return (
    <nav
      aria-label={props.label}
      className={cn(
        "misty-scrollbar min-h-0 flex-1 overflow-y-auto pl-3 pr-[calc(0.75rem-var(--misty-scrollbar-size))]",
        "[scrollbar-gutter:stable] max-[680px]:pl-2 max-[680px]:pr-[calc(0.5rem-var(--misty-scrollbar-size))]",
      )}
    >
      <div className="grid gap-1 pb-2">
        {props.items.map((entry) => {
          const Icon = entry.icon;
          return (
            <Fragment key={entry.id}>
              {entry.breakBefore && (
                <div aria-hidden className="mx-2.5 my-2 h-px bg-charcoal-border" />
              )}
              <NavigationSectionButton
                icon={Icon ? <Icon aria-hidden /> : null}
                label={entry.label}
                open={false}
                aria-expanded={undefined}
                showChevron={entry.hasSections}
                aria-current={props.activeId === entry.id ? "page" : undefined}
                data-settings-nav-entry={entry.id}
                className={cn(props.activeId === entry.id && "bg-charcoal-hover text-cream-bright")}
                onClick={() => props.onSelect(entry.id)}
              />
            </Fragment>
          );
        })}
      </div>
    </nav>
  );
}
