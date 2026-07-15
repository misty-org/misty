import { cn, NavigationSectionButton, NavigationTreeItem } from "@/shared/ui";
import type { LucideIcon } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
export interface DesktopSettingsNavEntry<Id extends string = string> {
  id: Id;
  label: string;
  icon?: LucideIcon;
  /** Adjacent entries sharing a parent are drawn as children of one disclosure. */
  parent?: { id: string; label: string; icon: LucideIcon };
  /** Draws an unlabeled hairline above this entry (or above its parent). */
  breakBefore?: boolean;
}
type Node<Id extends string> =
  | { kind: "leaf"; entry: DesktopSettingsNavEntry<Id> }
  | {
      kind: "parent";
      parent: NonNullable<DesktopSettingsNavEntry<Id>["parent"]>;
      breakBefore?: boolean;
      children: DesktopSettingsNavEntry<Id>[];
    };
function buildTree<Id extends string>(items: readonly DesktopSettingsNavEntry<Id>[]) {
  const nodes: Node<Id>[] = [];
  for (const entry of items) {
    const last = nodes.at(-1);
    if (!entry.parent) nodes.push({ kind: "leaf", entry });
    else if (last?.kind === "parent" && last.parent.id === entry.parent.id)
      last.children.push(entry);
    else
      nodes.push({
        kind: "parent",
        parent: entry.parent,
        breakBefore: entry.breakBefore,
        children: [entry],
      });
  }
  return nodes;
}
/** Only the area holding the active page starts open; others stay as the user leaves them. */
function useOpenParents(activeParent: string | undefined) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(activeParent ? [activeParent] : []));
  useEffect(() => {
    if (!activeParent) return;
    setOpen((current) => (current.has(activeParent) ? current : new Set(current).add(activeParent)));
  }, [activeParent]);
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return [open, toggle] as const;
}
const hairline = <div aria-hidden="true" className="mx-2.5 my-2 h-px bg-charcoal-border/70" />;
export function SettingsNavigation<Id extends string>(props: {
  items: readonly DesktopSettingsNavEntry<Id>[];
  activeId: Id;
  label: string;
  onSelect: (id: Id) => void;
}) {
  const activeParent = props.items.find((item) => item.id === props.activeId)?.parent?.id;
  const [open, toggle] = useOpenParents(activeParent);
  const leaf = (entry: DesktopSettingsNavEntry<Id>, nested: boolean) => {
    const Icon = entry.icon;
    return (
      <NavigationTreeItem
        key={entry.id}
        icon={!nested && Icon ? <Icon aria-hidden="true" /> : null}
        label={entry.label}
        selected={props.activeId === entry.id}
        nested={false}
        settings
        data-settings-nav-entry={entry.id}
        onClick={() => props.onSelect(entry.id)}
      />
    );
  };
  return (
    // The gutter is always reserved so rows never change width when the list starts
    // scrolling; the right padding gives back exactly the gutter's width.
    <nav
      aria-label={props.label}
      className={cn(
        "misty-scrollbar min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]",
        "pl-3 pr-[calc(0.75rem-var(--misty-scrollbar-size))] max-[680px]:pl-2",
        "max-[680px]:pr-[calc(0.5rem-var(--misty-scrollbar-size))]",
        "[&::-webkit-scrollbar-track]:bg-transparent",
      )}
    >
      <div className="grid gap-1 pb-2">
        {buildTree(props.items).map((node) => {
          if (node.kind === "leaf")
            return (
              <Fragment key={node.entry.id}>
                {node.entry.breakBefore ? hairline : null}
                {leaf(node.entry, false)}
              </Fragment>
            );
          const Icon = node.parent.icon;
          const expanded = open.has(node.parent.id);
          const childrenId = `settings-nav-${node.parent.id}`;
          return (
            <Fragment key={node.parent.id}>
              {node.breakBefore ? hairline : null}
              <NavigationSectionButton
                open={expanded}
                label={node.parent.label}
                icon={<Icon aria-hidden="true" />}
                aria-controls={childrenId}
                aria-label={`${expanded ? "Collapse" : "Expand"} ${node.parent.label} settings`}
                data-settings-nav-parent={node.parent.id}
                className={cn(activeParent === node.parent.id && "text-cream-bright")}
                onClick={() => toggle(node.parent.id)}
              />
              {expanded ? (
                <div
                  id={childrenId}
                  className="ml-[19px] grid gap-1 border-l border-charcoal-border/70 pl-2"
                >
                  {node.children.map((child) => leaf(child, true))}
                </div>
              ) : null}
            </Fragment>
          );
        })}
      </div>
    </nav>
  );
}
