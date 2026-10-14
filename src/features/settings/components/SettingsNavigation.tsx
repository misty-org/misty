import { cn, NavigationSectionButton } from "@/shared/ui";
import type { LucideIcon } from "lucide-react";
export interface DesktopSettingsNavEntry<Id extends string = string> {
  id: Id;
  label: string;
  icon?: LucideIcon;
}
/** The incumbent navigation chrome, with one destination per area and no disclosures, chevrons or dividers. */
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
        "misty-scrollbar min-h-0 flex-1 overflow-y-auto pl-3 pr-[max(0px,calc(0.75rem-var(--misty-scrollbar-size)))]",
        "[scrollbar-gutter:stable] max-[680px]:pl-2 max-[680px]:pr-[max(0px,calc(0.5rem-var(--misty-scrollbar-size)))]",
        // Roomier rows than the app navigator, matching the larger settings type.
        "[--navigation-row-height:36px] [--navigation-row-font-size:14px]",
        "[--navigation-primary-icon-size:18px] [--navigation-primary-icon-slot:20px]",
      )}
    >
      <div className="grid gap-1 pb-2">
        {props.items.map((entry) => {
          const Icon = entry.icon;
          return (
            <NavigationSectionButton
              key={entry.id}
              icon={Icon ? <Icon aria-hidden /> : null}
              label={entry.label}
              open={false}
              aria-expanded={undefined}
              showChevron={false}
              aria-current={props.activeId === entry.id ? "page" : undefined}
              data-settings-nav-entry={entry.id}
              className={cn(props.activeId === entry.id && "bg-charcoal-hover text-cream-bright")}
              onClick={() => props.onSelect(entry.id)}
            />
          );
        })}
      </div>
    </nav>
  );
}
