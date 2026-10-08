import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AppWindow, Check, Plus, SquarePlus, Trash2, Ungroup, X } from "lucide-react";
import {
  Button,
  ContextMenuAction,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  Input,
  Pressable,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/shared/ui";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { layoutTabs } from "@/features/workspace/layoutTabs";
import type { WorkspaceTab, WorkspaceView } from "@/features/workspace/model";
import {
  tabGroupColors,
  type MistyTabGroup,
  type TabGroupColor,
} from "@/features/workspace/tabGroups";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import "./tabGroups.css";

export const groupName = (group: MistyTabGroup) => group.name || "Unnamed group";
export const groupStyle = (group: MistyTabGroup): CSSProperties =>
  ({ "--tab-group-color": tabGroupColors[group.color] }) as CSSProperties;

export function TabGroupTabMenu({
  tab,
  onEdit,
  onOpen,
}: {
  tab: WorkspaceTab;
  onEdit(id: string): void;
  onOpen(tab: WorkspaceView): void;
}) {
  const groups = useWorkspaceStore((s) => s.tabGroups);
  const layout = useWorkspaceStore((s) => s.layout);
  const scope = useWorkspaceStore((s) => s.activeScopeKey);
  const saved = groups.filter((g) => g.scopeKey === scope && g.savedTabs?.length);
  const available = groups.filter((g) => layoutTabs(layout).some((t) => t.tabGroupId === g.id));
  return (
    <>
      <ContextMenuSub>
        <ContextMenuSubTrigger>Add tab to group</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuAction
            label="New group"
            icon={<Plus />}
            onSelect={() => {
              const id = useWorkspaceStore.getState().createTabGroup([tab.id]);
              if (id) onEdit(id);
            }}
          />
          {available.map((g) => (
            <ContextMenuAction
              key={g.id}
              label={groupName(g)}
              disabled={g.id === tab.tabGroupId}
              icon={<span className="misty-tab-group-dot" style={groupStyle(g)} />}
              onSelect={() => useWorkspaceStore.getState().addTabToGroup(tab.id, g.id)}
            />
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {tab.tabGroupId && (
        <ContextMenuAction
          label="Remove from group"
          onSelect={() => useWorkspaceStore.getState().addTabToGroup(tab.id, null)}
        />
      )}
      {saved.length > 0 && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>Reopen saved group</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {saved.map((group) => (
              <ContextMenuAction
                key={group.id}
                label={groupName(group)}
                icon={<span className="misty-tab-group-dot" style={groupStyle(group)} />}
                onSelect={() => {
                  const opened = useWorkspaceStore.getState().reopenTabGroup(group.id);
                  if (opened) onOpen(opened);
                }}
              />
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuSeparator />
    </>
  );
}

export function TabGroupHeader({
  group,
  count,
  onEdit,
  onOpen,
}: {
  group: MistyTabGroup;
  count: number;
  onEdit(id: string): void;
  onOpen(tab: WorkspaceView): void;
}) {
  return (
    <div
      data-tab-group-anchor={group.id}
      className="misty-tab-group-header"
      style={groupStyle(group)}
      data-collapsed={group.collapsed}
      data-reorder-item={`group-header:${group.id}`}
      data-reorder-preview="true"
      data-misty-window-drag-block="true"
    >
      <Pressable
        className="misty-tab-group-label"
        data-unnamed={group.name ? undefined : "true"}
        data-reorder-handle="true"
        aria-expanded={!group.collapsed}
        aria-label={`${groupName(group)}, ${count} ${count === 1 ? "tab" : "tabs"}, ${group.collapsed ? "collapsed" : "expanded"}`}
        title={`${groupName(group)} · ${count} ${count === 1 ? "tab" : "tabs"} · Click to ${group.collapsed ? "expand" : "collapse"}; right-click to configure`}
        aria-haspopup="dialog"
        onClick={() => {
          const tab = useWorkspaceStore.getState().toggleTabGroup(group.id);
          if (tab) onOpen(tab);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onEdit(group.id);
        }}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            onEdit(group.id);
          }
        }}
      >
        {group.name ? <span className="truncate">{group.name}</span> : null}
      </Pressable>
    </div>
  );
}

export function TabGroupEditor({
  id,
  onClose,
  onOpen,
}: {
  id: string;
  onClose(): void;
  onOpen(tab: WorkspaceView): void;
}) {
  const group = useWorkspaceStore((s) => s.tabGroups.find((g) => g.id === id));
  const [name, setName] = useState(group?.name ?? "");
  const [color, setColor] = useState<TabGroupColor>(group?.color ?? "blue");
  const [error, setError] = useState("");
  const anchor = useRef({
    getBoundingClientRect: () =>
      document
        .querySelector<HTMLElement>(`[data-tab-group-anchor="${CSS.escape(id)}"]`)
        ?.getBoundingClientRect() ?? new DOMRect(8, 38, 0, 0),
  });
  useEffect(() => {
    setBrowserWebviewsSuspended(true, "tab-group-editor");
    return () => setBrowserWebviewsSuspended(false, "tab-group-editor");
  }, []);
  if (!group) return null;
  const save = () => useWorkspaceStore.getState().updateTabGroup(id, { name, color });
  // Changes show on the strip as they are made, as in Chrome.
  const rename = (next: string) => {
    setName(next);
    useWorkspaceStore.getState().updateTabGroup(id, { name: next, color });
  };
  const recolor = (next: TabGroupColor) => {
    setColor(next);
    useWorkspaceStore.getState().updateTabGroup(id, { name, color: next });
  };
  const openCurrent = () => {
    const s = useWorkspaceStore.getState();
    const tab = s.selectTab(s.layout.activeTabId!);
    if (tab) onOpen(tab);
  };
  return (
    <Popover
      modal={false}
      open
      onOpenChange={(open) => {
        if (!open) {
          save();
          onClose();
        }
      }}
    >
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        align="start"
        side="bottom"
        aria-label="Edit tab group"
        className="w-72 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-1.5"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document
            .querySelector<HTMLElement>(`[data-tab-group-anchor="${CSS.escape(id)}"] button`)
            ?.focus();
        }}
      >
        <form
          className="grid gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            save();
            onClose();
          }}
        >
          <div className="grid gap-3 px-1.5 pb-2 pt-1.5">
            <Input
              autoFocus
              aria-label="Group name"
              value={name}
              maxLength={80}
              placeholder="Name this group"
              onChange={(e) => rename(e.target.value)}
            />
            <div role="radiogroup" aria-label="Group color" className="flex justify-between">
              {(Object.keys(tabGroupColors) as TabGroupColor[]).map((value) => (
                <Pressable
                  key={value}
                  type="button"
                  role="radio"
                  aria-label={value}
                  aria-checked={color === value}
                  className="misty-tab-group-swatch"
                  style={{ backgroundColor: tabGroupColors[value] }}
                  onClick={() => recolor(value)}
                >
                  {color === value ? <Check aria-hidden="true" /> : null}
                </Pressable>
              ))}
            </div>
          </div>
          <div className="grid border-t border-charcoal-border pt-1">
            <Button
              type="button"
              variant="ghost"
              justify="start"
              onClick={() => {
                save();
                const tab = useWorkspaceStore.getState().newTabInGroup(id);
                if (tab) onOpen(tab);
                onClose();
              }}
            >
              <SquarePlus aria-hidden="true" />
              New tab in group
            </Button>
            <Button
              type="button"
              variant="ghost"
              justify="start"
              onClick={() => {
                save();
                const tab = useWorkspaceStore.getState().moveTabGroupToNewWindow(id);
                if (tab) onOpen(tab);
                onClose();
              }}
            >
              <AppWindow aria-hidden="true" />
              Move group to new window
            </Button>
            <Button
              type="button"
              variant="ghost"
              justify="start"
              onClick={() => {
                useWorkspaceStore.getState().ungroupTabs(id);
                onClose();
              }}
            >
              <Ungroup aria-hidden="true" />
              Ungroup
            </Button>
            <Button
              type="button"
              variant="ghost"
              justify="start"
              title="Closes the tabs and keeps the group to reopen later"
              onClick={() => {
                save();
                if (!useWorkspaceStore.getState().closeTabGroup(id)) {
                  setError(
                    "A tab has unfinished changes. Finish or discard them before closing this group.",
                  );
                  return;
                }
                openCurrent();
                onClose();
              }}
            >
              <X aria-hidden="true" />
              Close group
            </Button>
          </div>
          <div className="grid border-t border-charcoal-border pt-1">
            <Button
              type="button"
              variant="ghost"
              justify="start"
              title="Closes the tabs and forgets the group"
              onClick={() => {
                if (!useWorkspaceStore.getState().closeTabGroup(id, false)) {
                  setError(
                    "A tab has unfinished changes. Finish or discard them before deleting this group.",
                  );
                  return;
                }
                openCurrent();
                onClose();
              }}
            >
              <Trash2 aria-hidden="true" />
              Delete group
            </Button>
          </div>
          {error && (
            <p role="alert" className="px-1.5 pb-1.5 text-sm text-cream">
              {error}
            </p>
          )}
        </form>
      </PopoverContent>
    </Popover>
  );
}
