import {
  Button,
  cn,
  NavigationSectionButton,
  NavigationTreeItem,
  navigationMenuGroupClass,
} from "@/shared/ui";
import { type LucideIcon, X } from "lucide-react";
import { createContext, Fragment, type ReactNode, useEffect, useState } from "react";

export const SettingsControlLabelContext = createContext<string | undefined>(undefined);

export function DesktopSettingsFrame<Id extends string>(props: DesktopSettingsFrameProps<Id>) {
  const overlay = props.presentation === "overlay";
  const mobile = props.presentation === "mobile";
  const activeGroup = props.items.find((item) => item.id === props.activeId)?.group;
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!activeGroup) return;
    setCollapsedGroups((current) => {
      if (!current.has(activeGroup)) return current;
      const next = new Set(current);
      next.delete(activeGroup);
      return next;
    });
  }, [activeGroup]);

  const toggleGroup = (group: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  if (mobile) {
    return (
      <div
        aria-label={props.ariaLabel}
        className="grid h-full min-h-0 grid-rows-[48px_auto_minmax(0,1fr)] overflow-hidden bg-charcoal-bg"
      >
        <header className="flex items-center gap-3 border-b border-charcoal-border px-3">
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-cream-bright">
            {props.title}
          </h1>
          <Button
            aria-label={`Close ${props.ariaLabel.toLowerCase()}`}
            size="icon-sm"
            type="button"
            variant="ghost"
            onClick={props.onClose}
          >
            <X className="size-4" strokeWidth={1.8} />
          </Button>
        </header>
        <nav
          className="misty-transient-scrollbar flex min-h-14 gap-1 overflow-x-auto border-b border-charcoal-border bg-charcoal-sidebar px-2 py-1.5"
          aria-label={props.navigationLabel}
        >
          {props.items.map((item) => {
            const Icon = item.icon;
            const active = item.id === props.activeId;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm",
                  active
                    ? "bg-charcoal-active text-cream-bright"
                    : "text-cream-muted hover:bg-charcoal-hover active:bg-charcoal-hover",
                )}
                onClick={() => props.onSelect(item.id)}
              >
                <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="misty-scrollbar min-h-0 overflow-y-auto overscroll-contain p-4">
          {props.children}
        </div>
      </div>
    );
  }

  return (
    <div
      aria-label={props.ariaLabel}
      className={cn(
        "grid min-h-0 min-w-0 grid-cols-[216px_1px_minmax(0,1fr)] overflow-hidden bg-charcoal-bg",
        overlay ? "h-full" : "h-screen",
        "max-[900px]:grid-cols-[184px_1px_minmax(0,1fr)]",
        "max-[680px]:grid-cols-[156px_1px_minmax(0,1fr)]",
      )}
    >
      <aside
        className={cn(
          "misty-scrollbar min-h-0 overflow-y-auto overscroll-contain bg-charcoal-sidebar px-3 py-3.5 text-cream-muted",
          "[scrollbar-gutter:stable] max-[680px]:px-2",
        )}
      >
        <nav className="flex min-h-0 flex-col" aria-label={props.navigationLabel}>
          <div className={navigationMenuGroupClass}>
            {props.items.map((item, index) => {
              const Icon = item.icon;
              const GroupIcon = item.groupIcon;
              const active = props.activeId === item.id;
              // Group captions use the global navigator's section-header
              // treatment so the two rails read as the same component.
              const startsGroup =
                item.group !== undefined && item.group !== props.items[index - 1]?.group;
              const endsGroup =
                item.group !== undefined && item.group !== props.items[index + 1]?.group;
              const groupCollapsed = item.group ? collapsedGroups.has(item.group) : false;
              return (
                <Fragment key={item.id}>
                  {startsGroup && item.groupLabel ? (
                    <h2 className={cn("flex h-8 shrink-0 items-center", index > 0 && "mt-1")}>
                      <NavigationSectionButton
                        open={!groupCollapsed}
                        label={item.groupLabel}
                        icon={
                          GroupIcon ? (
                            <GroupIcon aria-hidden="true" data-settings-group-icon="true" />
                          ) : null
                        }
                        aria-label={`${groupCollapsed ? "Expand" : "Collapse"} ${item.groupLabel} settings`}
                        onClick={() => item.group && toggleGroup(item.group)}
                      />
                    </h2>
                  ) : null}
                  {!groupCollapsed ? (
                    <NavigationTreeItem
                      icon={<Icon aria-hidden="true" />}
                      label={item.label}
                      selected={active}
                      last={endsGroup}
                      nested={Boolean(item.group)}
                      settings
                      data-settings-nav-entry={item.id}
                      onClick={() => props.onSelect(item.id)}
                    />
                  ) : null}
                </Fragment>
              );
            })}
          </div>
        </nav>
      </aside>

      <div aria-hidden="true" className="bg-charcoal-border" />

      <main className="flex min-h-0 min-w-0 flex-col bg-charcoal-bg">
        <header className="shrink-0 border-b border-charcoal-border/60 bg-charcoal-bg">
          <div className="flex min-h-12 min-w-0 items-center gap-3 px-5 py-2 max-[720px]:px-4">
            <div className="min-w-0 flex-1">
              <h1 className="min-w-0 truncate text-base font-semibold leading-6 text-cream">
                {props.title}
              </h1>
            </div>
            {overlay ? (
              <Button
                aria-label={`Close ${props.ariaLabel.toLowerCase()}`}
                size="icon-sm"
                type="button"
                variant="ghost"
                onClick={props.onClose}
              >
                <X className="size-4" strokeWidth={1.8} />
              </Button>
            ) : null}
          </div>
        </header>
        <div
          className={cn(
            "misty-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-5 max-[720px]:p-4",
            "mx-auto w-full",
            overlay ? "max-w-[760px]" : "max-w-[860px]",
          )}
        >
          {props.children}
        </div>
      </main>
    </div>
  );
}

export function DesktopSettingsSection(props: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-6 min-w-0 last:mb-0">
      <div className="mb-3 min-w-0">
        <h2 className="text-sm font-semibold leading-5 text-cream">{props.title}</h2>
        {props.description ? (
          <p className="mt-1 max-w-2xl text-[13px] leading-[18px] text-cream-muted">
            {props.description}
          </p>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-lg border border-charcoal-border/80 bg-charcoal-card">
        {props.children}
      </div>
    </section>
  );
}

export function DesktopSettingsRow(props: {
  label: string;
  description?: string;
  children: ReactNode;
  last?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      aria-disabled={props.muted || undefined}
      className={cn(
        "grid min-h-16 grid-cols-[minmax(0,0.52fr)_minmax(240px,0.48fr)] items-center gap-5 border-b border-charcoal-border/70 px-5 py-3.5 last:border-b-0",
        "max-[760px]:grid-cols-1 max-[760px]:items-start max-[760px]:gap-3",
        props.last && "border-b-0",
        props.muted && "bg-charcoal-bg/70",
      )}
    >
      <div className="grid min-w-0 gap-1">
        <strong
          className={cn(
            "text-sm font-medium leading-5",
            props.muted ? "text-cream-muted" : "text-cream",
          )}
        >
          {props.label}
        </strong>
        {props.description ? (
          <span className="text-[13px] leading-[18px] text-cream-muted">{props.description}</span>
        ) : null}
      </div>
      <SettingsControlLabelContext.Provider value={props.label}>
        <div className="flex min-w-0 items-center justify-end max-[760px]:w-full max-[760px]:justify-start">
          {props.children}
        </div>
      </SettingsControlLabelContext.Provider>
    </div>
  );
}

export interface DesktopSettingsNavEntry<Id extends string = string> {
  id: Id;
  label: string;
  icon: LucideIcon;
  /** Adjacent entries sharing a group are drawn together. */
  group?: string;
  /** Caption shown above the first entry of a group. Omit for an unlabeled break. */
  groupLabel?: string;
  groupIcon?: LucideIcon;
}

export interface DesktopSettingsFrameProps<Id extends string> {
  activeId: Id;
  ariaLabel: string;
  children: ReactNode;
  items: readonly DesktopSettingsNavEntry<Id>[];
  navigationLabel: string;
  onClose?: () => void;
  onSelect: (id: Id) => void;
  presentation?: "page" | "overlay" | "mobile";
  title: ReactNode;
}
