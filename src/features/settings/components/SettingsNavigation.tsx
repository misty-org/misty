import { cn, NavGroupHeading, NavList, NavRow, OverflowFadeText } from "@misty/ui";
import type { LucideIcon } from "lucide-react";
import { Fragment } from "react";
export interface DesktopSettingsNavEntry<Id extends string = string> {
  id: Id;
  label: string;
  icon?: LucideIcon;
}
export interface DesktopSettingsPageSection {
  id: string;
  label: string;
}
export interface DesktopSettingsNavGroup<Id extends string = string> {
  label: string;
  items: readonly DesktopSettingsNavEntry<Id>[];
}
export function SettingsNavigation<Id extends string>(props: {
  groups: readonly DesktopSettingsNavGroup<Id>[];
  activeId: Id;
  label: string;
  onSelect: (id: Id) => void;
  sections?: readonly DesktopSettingsPageSection[];
  activeSection?: string;
  onSection?: (id: string) => void;
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
              const open = props.activeId === entry.id;
              return (
                <Fragment key={entry.id}>
                  <NavRow
                    tone="page"
                    current={open && !props.activeSection}
                    selected={open && Boolean(props.activeSection)}
                    data-settings-nav-entry={entry.id}
                    data-misty-window-drag-block="true"
                    onClick={() => props.onSelect(entry.id)}
                  >
                    {Icon ? <Icon aria-hidden /> : null}
                    <OverflowFadeText>{entry.label}</OverflowFadeText>
                  </NavRow>
                  {open
                    ? props.sections?.map((section) => (
                        <NavRow
                          key={section.id}
                          tone="page"
                          nested
                          current={props.activeSection === section.id}
                          data-misty-window-drag-block="true"
                          onClick={() => props.onSection?.(section.id)}
                        >
                          <OverflowFadeText>{section.label}</OverflowFadeText>
                        </NavRow>
                      ))
                    : null}
                </Fragment>
              );
            })}
          </NavList>
        </div>
      ))}
    </nav>
  );
}
