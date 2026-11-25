import { Plus } from "lucide-react";
import { useState } from "react";
import {
  activeLayoutView,
  dockTreeViews,
  isEmptyTab,
  layoutTabs,
  tabLabel,
  useWorkspaceStore,
  type WorkspaceTabGroup,
  type WorkspaceView,
} from "@/features/app-windows";
import {
  IconButton,
  RenameItemDialog,
  TabStrip,
  windowToolbarClass,
  type TabStripGroup,
  type TabStripTab,
} from "@misty/ui";
import { setPageMuted, usePageMedia, type PlayingPage } from "@/features/browser";
import { usePlayingSources } from "./page_media_views";
import { GroupMenu, TabMenu } from "./WorkspaceTabMenus";
import { openNewTab } from "./space_navigation";
import { WorkspaceTabIcon } from "./WorkspaceTabIcon";
import { windowsCaptionSlotId } from "./WindowsTitlebarControls";

export function WorkspaceTabBar(props: {
  gridColumn: number;
  captionSlot?: boolean;
  onOpen(view: WorkspaceView): void;
  onClosed(): void;
}) {
  const layout = useWorkspaceStore((state) => state.layout);
  const [naming, setNaming] = useState<WorkspaceTabGroup | null>(null);
  const store = useWorkspaceStore.getState;
  const tabs = layoutTabs(layout).filter((tab) => !isEmptyTab(tab));
  const groups = layout.groups ?? [];
  const close = (id: string) => {
    if (store().closeTab(id)) props.onClosed();
  };
  const sources = usePlayingSources();
  const mutedPages = usePageMedia((state) => state.muted);
  const playingIn = new Map<string, PlayingPage[]>();
  for (const source of sources)
    if (source.view && source.page.media.playing)
      playingIn.set(source.view.id, [...(playingIn.get(source.view.id) ?? []), source.page]);
  const items: TabStripTab[] = tabs.map((tab) => {
    const view = activeLayoutView(tab);
    const label = tabLabel(tab);
    const playing = dockTreeViews(tab.root).flatMap((pane) => playingIn.get(pane.id) ?? []);
    const muted = playing.length > 0 && playing.every((page) => mutedPages[page.key]);
    return {
      id: tab.id,
      sound: playing.length
        ? {
            muted,
            onToggle: () => playing.forEach((page) => setPageMuted(page, !muted)),
          }
        : undefined,
      label,
      icon: <WorkspaceTabIcon view={view ?? undefined} />,
      closeLabel: `Close ${label}`,
      group: tab.group,
      menu: (
        <TabMenu
          tab={tab}
          groups={groups}
          onClose={() => close(tab.id)}
          onChanged={props.onClosed}
        />
      ),
    };
  });
  const stripGroups: TabStripGroup[] = groups.map((group) => ({
    id: group.id,
    label: group.title,
    color: group.color,
    collapsed: group.collapsed,
    menu: (
      <GroupMenu
        group={group}
        onName={() => setNaming(group)}
        onOpen={props.onOpen}
        onChanged={props.onClosed}
      />
    ),
  }));
  const select = (id: string) => {
    const view = store().selectTab(id);
    if (view) props.onOpen(view);
  };

  return (
    <div
      className={`min-w-0 ${windowToolbarClass}`}
      style={{ gridColumn: props.gridColumn, gridRow: 2 }}
      data-window-toolbar="beside-drawer"
      data-misty-window-titlebar-region="true"
    >
      <TabStrip
        label="Open pages"
        tabs={items}
        groups={stripGroups}
        active={layout.activeTabId ?? null}
        onSelect={select}
        dragCarries={(id) => {
          const tab = tabs.find((candidate) => candidate.id === id);
          const view = tab && activeLayoutView(tab);
          return view ? { "workspace-tabs": view.id } : undefined;
        }}
        onDragDwell={select}
        onClose={close}
        onReorder={(id, index, group) => {
          const rest = layoutTabs(store().layout)
            .map((tab) => tab.id)
            .filter((other) => other !== id);
          const target = items.filter((item) => item.id !== id)[index]?.id;
          store().moveTab(id, target ? rest.indexOf(target) : rest.length, group);
        }}
        onToggleGroup={(id) => {
          const view = store().toggleTabGroup(id);
          if (view) props.onOpen(view);
        }}
        onDropOnTab={(id, target) => store().groupTabWith(id, target)}
        onDropOnGroup={(id, group) => store().addTabToGroup(id, group)}
        onMoveGroup={(group, before) => store().moveTabGroup(group, before)}
        after={
          <IconButton label="New tab" onClick={() => openNewTab(props.onOpen)}>
            <Plus />
          </IconButton>
        }
        end={
          props.captionSlot ? (
            <div id={windowsCaptionSlotId} className="flex items-center" />
          ) : undefined
        }
        windowEdge
      />
      {naming ? (
        <RenameItemDialog
          key={naming.id}
          title={naming.title ? "Rename group" : "Name group"}
          initialName={naming.title}
          onConfirm={async (title) => store().updateTabGroup(naming.id, { title })}
          onClose={() => setNaming(null)}
        />
      ) : null}
    </div>
  );
}
