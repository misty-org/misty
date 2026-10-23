import type { CSSProperties } from "react";
import { Plus } from "lucide-react";
import {
  ContextMenuAction,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  Pressable,
} from "@/shared/ui";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { layoutTabs } from "@/features/workspace/layoutTabs";
import type { WorkspaceTab, WorkspaceView } from "@/features/workspace/model";
import { tabGroupColors, type MistyTabGroup } from "@/features/workspace/tabGroups";
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
