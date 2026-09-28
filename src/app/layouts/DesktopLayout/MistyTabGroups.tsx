import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Plus } from "lucide-react";
import {
  Button,
  ContextMenuAction,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  Field,
  Input,
  Pressable,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/shared/ui";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { layoutTabs } from "@/features/workspace/layoutTabs";
import type { WorkspaceLayoutTab, WorkspaceTab } from "@/features/workspace/model";
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
  tab: WorkspaceLayoutTab;
  onEdit(id: string): void;
  onOpen(tab: WorkspaceTab): void;
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
  onOpen(tab: WorkspaceTab): void;
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
        <span className="truncate">{groupName(group)}</span>
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
  onOpen(tab: WorkspaceTab): void;
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
  const openCurrent = () => {
    const s = useWorkspaceStore.getState();
    const tab = s.selectLayoutTab(s.layout.activeLayoutTabId!);
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
        className="w-72 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-3"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document
            .querySelector<HTMLElement>(`[data-tab-group-anchor="${CSS.escape(id)}"] button`)
            ?.focus();
        }}
      >
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
            onClose();
          }}
        >
          <Field label="Group name">
            <Input
              autoFocus
              value={name}
              maxLength={80}
              placeholder="Unnamed group"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm">Color</legend>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(tabGroupColors) as TabGroupColor[]).map((value) => (
                <Pressable
                  key={value}
                  type="button"
                  aria-label={value}
                  aria-pressed={color === value}
                  className="misty-tab-group-swatch"
                  style={{ backgroundColor: tabGroupColors[value] }}
                  onClick={() => setColor(value)}
                />
              ))}
            </div>
          </fieldset>
          <div className="grid gap-1 border-t border-charcoal-border pt-2">
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
              Ungroup tabs
            </Button>
            <Button
              type="button"
              variant="ghost"
              justify="start"
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
              Close and save group
            </Button>
            <Button
              type="button"
              variant="ghost"
              justify="start"
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
              Delete group and close tabs
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit">Done</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
