import { cn, Pressable, Surface, Text } from "@/shared/ui";
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
      className={cn("misty-scrollbar min-h-0 flex-1 overflow-y-auto px-3 max-[680px]:px-2")}
    >
      {props.groups.map((group) => (
        <div key={group.label} role="group" aria-label={group.label} className="pb-3">
          <Text as="p" tone="muted" className="px-2.5 pb-1.5 pt-2 text-ui leading-5">
            {group.label}
          </Text>
          <div className="grid gap-0.5">
            {group.items.map((entry) => {
              const Icon = entry.icon;
              const active = props.activeId === entry.id;
              const row = {
                "aria-current": active ? ("page" as const) : undefined,
                "data-settings-nav-entry": entry.id,
                "data-misty-window-drag-block": "true",
                className: cn(
                  "flex h-9 w-full min-w-0 items-center gap-3 px-2.5 text-left text-md leading-5",
                  "transition-colors",
                ),
                onClick: () => props.onSelect(entry.id),
              };
              const content = (
                <>
                  {Icon ? (
                    <Text bare tone={active ? "bright" : "muted"} className="flex shrink-0">
                      <Icon aria-hidden />
                    </Text>
                  ) : null}
                  <Text tone={active ? "bright" : "default"} className="flex-1">
                    {entry.label}
                  </Text>
                </>
              );
              // The open page is filled; the others wash on hover like the sidebar's rows.
              return active ? (
                <Surface key={entry.id} as={Pressable} tone="well" radius="lg" {...row}>
                  {content}
                </Surface>
              ) : (
                <Pressable
                  key={entry.id}
                  wash="row"
                  {...row}
                  className={cn(row.className, "rounded-lg")}
                >
                  {content}
                </Pressable>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
