import { Renameable } from "@/features/navigation-names/Renameable";
import { useNavigationNames, navigationName, tabNameKey } from "@/features/navigation-names/store";
import { usePointerReorder } from "@/shared/hooks/usePointerReorder";
import { Button } from "@/shared/ui";
import { Plus, X } from "lucide-react";
import { memo, useEffect, useRef, useState, type WheelEvent } from "react";
import type { ChromeTabStripProps } from "./model/interfaces";
export type { ChromeTabStripProps, ChromeTabStripTab } from "./model/interfaces";

const chromeTabShellClass = [
  "chrome-tab-strip flex h-[46px] min-w-0 overflow-hidden border-b border-charcoal-border bg-charcoal-sidebar",
].join(" ");

const tabCloseButtonClass = [
  "mr-1.5 grid size-6 flex-none place-items-center rounded-full border-0",
  "bg-transparent text-current transition-colors hover:text-cream-bright focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cream-muted",
].join(" ");

const chromeTabTrayClass = [
  "mt-1.5 mr-2 flex h-8 flex-none items-center justify-end gap-0.5 rounded-lg p-0.5",
].join(" ");

const tabSelectButtonClass = [
  "flex h-full min-w-0 flex-1 items-center gap-2 overflow-hidden border-0",
  "bg-transparent py-0 pl-3 pr-1.5 text-left text-inherit focus-visible:outline-none",
  "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cream-muted",
].join(" ");

const addTabButtonClass = [
  "grid size-7 place-items-center rounded-full border-0 bg-transparent p-0 text-cream-muted",
  "hover:text-cream-bright focus-visible:outline-none focus-visible:ring-1",
  "focus-visible:ring-cream-muted",
].join(" ");

export const ChromeTabStrip = memo(function ChromeTabStrip(props: ChromeTabStripProps) {
  useNavigationNames();
  const shellRef = useRef<HTMLDivElement | null>(null);

  const [renamingTabId, setRenamingTabId] = useState("");
  const registerTabDropTarget = props.registerTabDropTarget;

  useEffect(() => {
    if (!registerTabDropTarget) return;
    let disposed = false;
    let cleanups: Array<() => void> = [];
    const frame = window.requestAnimationFrame(() => {
      if (disposed || !shellRef.current) return;
      cleanups = props.tabs.flatMap((tab) => {
        const element = Array.from(
          shellRef.current?.querySelectorAll<HTMLElement>(".chrome-tab[data-tab-id]") ?? [],
        ).find((candidate) => candidate.dataset.tabId === tab.id);
        if (!element) return [];
        return [
          registerTabDropTarget(
            element,
            tab,
            () => props.onSelectTab(tab.id),
            tab.id !== props.activeTabId,
          ),
        ];
      });
    });
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [props, registerTabDropTarget]);

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const tabs = reorder.ref.current;
    if (!tabs || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    tabs.scrollLeft += event.deltaY;
    event.preventDefault();
  };

  const reorder = usePointerReorder({
    scope: `chrome-tabs:${props.dragScope ?? "workspace"}`,
    axis: "x",
    getDrag: (id) => {
      const tab = props.tabs.find((tab) => tab.id === id);
      return tab && !renamingTabId && (props.onReorderTab || props.onMoveTab)
        ? { id, label: tab.title, paneId: tab.paneId }
        : null;
    },
    onDrop: (drag, target, after) => {
      const destination = props.paneId ?? props.tabs[0]?.paneId;
      if (!destination || drag.id === target) return;
      if (drag.paneId === destination) {
        const from = props.tabs.findIndex((tab) => tab.id === drag.id);
        const to = workspaceTabDropIndex(
          props.tabs.map((tab) => tab.id),
          drag.id,
          target,
          after,
        );
        if (from >= 0 && to >= 0 && from !== to) props.onReorderTab?.(drag.id, from, to);
      } else if (drag.paneId) {
        const index = target
          ? props.tabs.findIndex((tab) => tab.id === target) + (after ? 1 : 0)
          : 0;
        props.onMoveTab?.(drag.id, drag.paneId, destination, index);
      }
    },
    onKeyboardMove: (id, direction) => {
      const from = props.tabs.findIndex((tab) => tab.id === id),
        to = from + direction;
      if (from >= 0 && to >= 0 && to < props.tabs.length) props.onReorderTab?.(id, from, to);
    },
  });

  return (
    <div ref={shellRef} className={`${chromeTabShellClass} ${props.className ?? ""}`}>
      <div
        {...reorder}
        className="flex h-[46px] min-w-0 flex-1 items-end gap-1 overflow-x-auto overflow-y-hidden px-2 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label={props.ariaLabel ?? "Open locations"}
        onWheel={handleWheel}
      >
        {props.tabs.map((sourceTab) => {
          const nameKey = tabNameKey(
            `${props.dragScope ?? "chrome"}:${sourceTab.namingId ?? sourceTab.id}`,
          );
          const tab = { ...sourceTab, title: navigationName(nameKey, sourceTab.title) };
          const active = tab.id === props.activeTabId;
          const canClose = props.canCloseTab ? props.canCloseTab(tab) : true;
          const canRename = Boolean(props.onRenameTab && props.canRenameTab?.(tab));
          const renaming = canRename && renamingTabId === tab.id;
          return (
            <Renameable key={tab.id} nameKey={nameKey} automatic={sourceTab.title}>
              <div
                className={[
                  "chrome-tab group relative flex h-9 min-w-[92px] max-w-60 flex-[0_1_180px]",
                  "items-center overflow-hidden rounded-t-lg border border-charcoal-border",
                  "text-cream-muted transition-colors",
                  // The selected tab takes the colour of the pane it opens onto,
                  // the way a browser tab joins its page, instead of a fill that
                  // belongs to nothing below it.
                  active
                    ? "shrink-[0.85] border-b-charcoal-bg bg-charcoal-bg text-cream-bright"
                    : "bg-charcoal-card hover:text-cream-bright",
                ].join(" ")}
                data-tab-id={tab.id}
                data-reorder-item={tab.id}
                data-reorder-preview="true"
                data-active={active ? "true" : "false"}
                data-misty-window-drag-block={
                  props.onReorderTab || props.onMoveTab ? "true" : undefined
                }
                data-reorder-drag-source={
                  props.onReorderTab || props.onMoveTab ? "true" : undefined
                }
                draggable={false}
              >
                {renaming ? (
                  <TabTitleInput
                    title={sourceTab.title}
                    onCancel={() => setRenamingTabId("")}
                    onCommit={(next) => {
                      setRenamingTabId("");
                      if (next && next !== tab.title) props.onRenameTab?.(tab.id, next);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={tabSelectButtonClass}
                    role="tab"
                    data-reorder-handle={props.onReorderTab || props.onMoveTab ? "true" : undefined}
                    aria-description="Drag to reorder. Alt+Shift+Left or Right also moves this tab."
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    title={tab.path ? `${tab.title} · ${tab.path}` : tab.title}
                    onClick={() => {
                      props.onSelectTab(tab.id);
                    }}
                    onDoubleClick={() => {
                      if (canRename) setRenamingTabId(tab.id);
                    }}
                    onKeyDown={(event) => {
                      const nextIndex = tabIndexFromKey(event.key, props.tabs, tab.id);
                      if (nextIndex === null) return;
                      event.preventDefault();
                      const next = props.tabs[nextIndex];
                      if (!next) return;
                      props.onSelectTab(next.id);
                      window.requestAnimationFrame(() => {
                        shellRef.current
                          ?.querySelector<HTMLElement>(
                            `.chrome-tab[data-tab-id="${CSS.escape(next.id)}"] [role="tab"]`,
                          )
                          ?.focus();
                      });
                    }}
                  >
                    {tab.leading ? (
                      <span className="grid shrink-0 place-items-center" aria-hidden="true">
                        {tab.leading}
                      </span>
                    ) : null}
                    <span className="min-w-0 truncate text-[13px] font-medium">{tab.title}</span>
                  </button>
                )}
                {canClose ? (
                  <button
                    type="button"
                    className={tabCloseButtonClass}
                    tabIndex={active ? 0 : -1}
                    aria-label={`Close ${tab.title}`}
                    title={`Close ${tab.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onCloseTab(tab);
                    }}
                  >
                    {tab.dirty ? (
                      <>
                        <span
                          className="text-[15px] leading-none text-current group-hover:hidden"
                          aria-hidden="true"
                        >
                          •
                        </span>
                        <X className="hidden group-hover:block" size={13} strokeWidth={2} />
                      </>
                    ) : (
                      <X size={13} strokeWidth={2} />
                    )}
                  </button>
                ) : null}
              </div>
            </Renameable>
          );
        })}
        {/* Sits on the tab row's own baseline; the old bottom padding lifted
            it above the tab titles it belongs beside. */}
        {props.showAddTabControl === false ? null : (
          <div className="flex h-9 flex-none items-center pl-1">
            {props.addTabControl ?? (
              <Button
                type="button"
                className={addTabButtonClass}
                title="New tab"
                aria-label="New tab"
                onClick={props.onAddTab}
              >
                <Plus size={17} strokeWidth={2.4} />
              </Button>
            )}
          </div>
        )}
      </div>
      {props.actions ? <div className={chromeTabTrayClass}>{props.actions}</div> : null}
    </div>
  );
});

function tabIndexFromKey(
  key: string,
  tabs: ChromeTabStripProps["tabs"],
  activeId: string,
): number | null {
  if (!tabs.length) return null;
  if (key === "Home") return 0;
  if (key === "End") return tabs.length - 1;
  if (!["ArrowLeft", "ArrowRight"].includes(key)) return null;
  const current = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeId),
  );
  return (current + (key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length;
}

/**
 * Inline tab rename. Blur commits rather than cancels, matching how the rest of
 * the app treats an edited-then-abandoned field; Escape is the way out.
 */
function TabTitleInput(props: {
  title: string;
  onCancel: () => void;
  onCommit: (title: string) => void;
}) {
  const [value, setValue] = useState(props.title);
  const canceledRef = useRef(false);

  return (
    <input
      className="h-full min-w-0 flex-1 border-none bg-transparent px-3 text-[13px] font-medium text-cream-bright outline-none"
      value={value}
      autoFocus
      maxLength={60}
      aria-label={`Rename ${props.title}`}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={() => {
        if (canceledRef.current) return;
        props.onCommit(value.trim());
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          props.onCommit(value.trim());
        }
        if (event.key === "Escape") {
          event.preventDefault();
          canceledRef.current = true;
          props.onCancel();
        }
      }}
      onFocus={(event) => event.currentTarget.select()}
    />
  );
}

export function workspaceTabDropIndex(
  order: string[],
  sourceId: string,
  targetId: string,
  insertAfter: boolean,
): number {
  if (sourceId === targetId || !order.includes(sourceId) || !order.includes(targetId)) return -1;
  const remaining = order.filter((id) => id !== sourceId);
  const targetIndex = remaining.indexOf(targetId);
  return targetIndex + (insertAfter ? 1 : 0);
}
