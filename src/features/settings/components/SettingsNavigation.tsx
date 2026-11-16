import { cn, NavGroupHeading, NavList, NavRow, OverflowFadeText } from "@/shared/ui";
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
 * chevrons or dividers. The rows are the sidebar's own (`NavRow`), in the page's text, so every
 * navigation list in Misty has one height, rounding and padding.
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
      className={cn("misty-scrollbar min-h-0 flex-1 overflow-y-auto px-3 max-[748px]:px-2")}
    >
      {props.groups.map((group) => (
        <div key={group.label} role="group" aria-label={group.label} className="pb-3">
          <NavGroupHeading tone="page" name={group.label} className="mt-2 mb-1" />
          <NavList>
            {group.items.map((entry) => {
              const Icon = entry.icon;
              return (
                <NavRow
                  key={entry.id}
                  tone="page"
                  current={props.activeId === entry.id}
                  data-settings-nav-entry={entry.id}
                  data-misty-window-drag-block="true"
                  onClick={() => props.onSelect(entry.id)}
                >
                  {Icon ? <Icon aria-hidden /> : null}
                  <OverflowFadeText>{entry.label}</OverflowFadeText>
                </NavRow>
              );
            })}
          </NavList>
        </div>
      ))}
    </nav>
  );
}
