import {
  Button,
  TreeBranch,
  cn,
  navigationDisclosureChevronClass,
  navigationDisclosureLabelClass,
  navigationTreeBranchClass,
  navigationTreeGroupClass,
  navigationTreeIconClass,
  navigationTreeItemIconClass,
  navigationTreeRowClass,
  navigationTreeSurfaceClass,
} from "@/shared/ui";
import { ChevronDown, type LucideIcon, X } from "lucide-react";
import { createContext, Fragment, type ReactNode, useEffect, useState } from "react";

export const SettingsControlLabelContext = createContext<string | undefined>(undefined);

export function DesktopSettingsFrame<Id extends string>(props: DesktopSettingsFrameProps<Id>) {
  const overlay = props.presentation === "overlay";
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
          <div className={navigationTreeGroupClass}>
            {props.items.map((item, index) => {
              const Icon = item.icon;
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
                    <h2 className={cn("flex h-7 shrink-0 items-center", index > 0 && "mt-2.5")}>
                      <button
                        aria-expanded={!groupCollapsed}
                        aria-label={`${groupCollapsed ? "Expand" : "Collapse"} ${item.groupLabel} settings`}
                        className={cn(
                          navigationDisclosureLabelClass,
                          "h-7 w-full rounded-md px-2.5 text-left",
                          "text-[13px] font-semibold tracking-normal text-cream-muted",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal-active",
                        )}
                        onClick={() => item.group && toggleGroup(item.group)}
                        type="button"
                      >
                        <span className="truncate">{item.groupLabel}</span>
                        <ChevronDown
                          aria-hidden="true"
                          className={cn(
                            navigationDisclosureChevronClass,
                            "size-4 transition-transform duration-150 motion-reduce:transition-none",
                            groupCollapsed && "-rotate-90",
                          )}
                          data-chevron-placement="inline"
                          strokeWidth={1.8}
                        />
                      </button>
                    </h2>
                  ) : null}
                  {!groupCollapsed ? (
                    <Button
                      type="button"
                      variant="ghost"
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "w-full justify-start rounded-md font-medium",
                        "text-cream-muted transition-colors active:not-aria-[haspopup]:translate-y-0",
                        "hover:text-cream-bright",
                        "focus-visible:ring-2 focus-visible:ring-charcoal-active",
                        item.group
                          ? cn(navigationTreeRowClass, "w-[calc(100%_-_2rem)] gap-0 p-0")
                          : "h-9 gap-2.5 px-2.5 text-sm hover:bg-charcoal-card",
                        active &&
                          (item.group ? "text-cream-bright" : "bg-charcoal-card text-cream-bright"),
                      )}
                      data-settings-nav-entry={item.id}
                      onClick={() => props.onSelect(item.id)}
                    >
                      {item.group ? (
                        <TreeBranch
                          className={navigationTreeBranchClass}
                          first={startsGroup}
                          last={endsGroup}
                        />
                      ) : null}
                      {item.group ? (
                        <span
                          className={cn(
                            navigationTreeSurfaceClass,
                            "group-hover/tree-row:bg-charcoal-card",
                            active && "bg-charcoal-card/80",
                          )}
                          data-settings-nav-surface="true"
                        >
                          <span className={cn(navigationTreeIconClass, item.iconClassName)}>
                            <Icon className={navigationTreeItemIconClass} strokeWidth={1.85} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                        </span>
                      ) : (
                        <>
                          <span className="grid size-4 shrink-0 place-items-center">
                            <Icon className="size-4" strokeWidth={1.8} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                        </>
                      )}
                    </Button>
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
  /** Optional semantic color, shared with the corresponding navbar app icon. */
  iconClassName?: string;
  /** Adjacent entries sharing a group are drawn together. */
  group?: string;
  /** Caption shown above the first entry of a group. Omit for an unlabeled break. */
  groupLabel?: string;
}

export interface DesktopSettingsFrameProps<Id extends string> {
  activeId: Id;
  ariaLabel: string;
  children: ReactNode;
  items: readonly DesktopSettingsNavEntry<Id>[];
  navigationLabel: string;
  onClose?: () => void;
  onSelect: (id: Id) => void;
  presentation?: "page" | "overlay";
  title: ReactNode;
}
