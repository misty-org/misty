import {
  canShowSideBySide,
  dockLeaves,
  layoutTabs,
  useWorkspaceStore,
  type WorkspaceTab,
  type WorkspaceTabGroup,
  type WorkspaceView,
} from "@/features/app-windows";
import {
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubmenu,
  TabGroupDot,
  isTabGroupColor,
  tabGroupColorName,
  tabGroupColors,
} from "@misty/ui";

const store = useWorkspaceStore.getState;

export const groupName = (group: WorkspaceTabGroup) => group.title || "Unnamed group";

export function TabMenu(props: {
  tab: WorkspaceTab;
  groups: WorkspaceTabGroup[];
  onClose(): void;
  onChanged(): void;
}) {
  const { tab, groups } = props;
  const others = groups.filter((group) => group.id !== tab.group);
  return (
    <>
      {others.length ? (
        <MenuSubmenu label={tab.group ? "Move tab to group" : "Add tab to group"} width="sm">
          <MenuItem label="New group" onSelect={() => store().newTabGroup(tab.id)} />
          <MenuSeparator />
          {others.map((group) => (
            <MenuItem
              key={group.id}
              icon={<TabGroupDot color={group.color} />}
              label={groupName(group)}
              onSelect={() => store().addTabToGroup(tab.id, group.id)}
            />
          ))}
        </MenuSubmenu>
      ) : tab.group ? null : (
        <MenuItem label="Add tab to new group" onSelect={() => store().newTabGroup(tab.id)} />
      )}
      {tab.group ? (
        <MenuItem label="Remove from group" onSelect={() => store().removeTabFromGroup(tab.id)} />
      ) : null}
      {dockLeaves(tab.root).length > 1 ? (
        <MenuItem
          label="Separate into tabs"
          onSelect={() => {
            store().separateTab(tab.id);
            props.onChanged();
          }}
        />
      ) : null}
      <MenuSeparator />
      <MenuItem label="Close tab" onSelect={props.onClose} />
    </>
  );
}

function sideBySideReason(group: WorkspaceTabGroup): string {
  const members = layoutTabs(store().layout).filter((tab) => tab.group === group.id);
  return members.length < 2 ? "Add another tab to the group first" : "Side by side fits 4 panes";
}

export function GroupMenu(props: {
  group: WorkspaceTabGroup;
  onName(): void;
  onOpen(view: WorkspaceView): void;
  onChanged(): void;
}) {
  const { group } = props;
  const fits = canShowSideBySide(store().layout, group.id);
  return (
    <>
      <MenuItem label={group.title ? "Rename group" : "Name group"} onSelect={props.onName} />
      <MenuSubmenu label="Color" width="sm">
        <MenuRadioGroup
          value={group.color}
          onValueChange={(color) => {
            if (isTabGroupColor(color)) store().updateTabGroup(group.id, { color });
          }}
        >
          {tabGroupColors.map((color) => (
            <MenuRadioItem
              key={color}
              value={color}
              icon={<TabGroupDot color={color} />}
              label={tabGroupColorName(color)}
            />
          ))}
        </MenuRadioGroup>
      </MenuSubmenu>
      <MenuSeparator />
      <MenuItem
        label="New tab in group"
        onSelect={() => props.onOpen(store().newTabInGroup(group.id))}
      />
      <MenuItem
        label="Show side by side"
        disabled={!fits}
        reason={fits ? undefined : sideBySideReason(group)}
        onSelect={() => {
          store().showTabGroupSideBySide(group.id);
          props.onChanged();
        }}
      />
      <MenuItem label="Ungroup" onSelect={() => store().ungroupTabs(group.id)} />
      <MenuItem
        label="Close group"
        onSelect={() => {
          if (store().closeTabGroup(group.id)) props.onChanged();
        }}
      />
    </>
  );
}
