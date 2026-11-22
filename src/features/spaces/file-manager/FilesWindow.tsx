// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import { ArrowRightLeft, Folder, Plus } from "lucide-react";
import { Fragment } from "react";
import { IconButton, MenuItem, SplitHandle, SplitPane, SplitPanes, TabStrip } from "@misty/ui";
import { FilesFrame } from "./FilesFrame";
import { FilesPane } from "./FilesPane";
import { FilesSidebar } from "./FilesSidebar";
import { useFilesWorkspaces, type FilesTab } from "./filesWorkspaces";
import { isMac } from "./keyLabels";
import type { FilesPlace } from "./model";
import { TransfersView } from "./TransfersView";
import { useFilesChoices } from "./useFilesBrowser";
import { useFilesPlaces } from "./useFilesPlaces";
import { FilesWorkspaceSwitcher } from "./FilesWorkspaceSwitcher";

/** The sidebar while the Transfers tab is open: a place picked there opens in a new tab. */
function TransfersSidebar({ granted, onGo }: { granted: boolean; onGo(place: FilesPlace): void }) {
  const places = useFilesPlaces(granted);
  const choices = useFilesChoices(false);
  return (
    <FilesSidebar
      current={null}
      granted={granted}
      picking={false}
      places={places.places}
      tags={places.tags}
      agentTrash={places.agentTrash}
      macos={isMac}
      folded={choices.folded}
      onFold={choices.setFolded}
      onGo={onGo}
    />
  );
}

/**
 * The Files page as Kura's window: workspaces switched from the top of the sidebar, each a set of
 * tabs; a tab is a folder, split into panes side by side or one over another, or Transfers. Tabs open from New tab, a
 * folder's Open in new tab, or Transfers (⇄), close from their closer and reorder by dragging. All of
 * it is kept for the device, so Files opens where it was left.
 */
export function FilesWindow({ granted, start }: { granted: boolean; start: FilesPlace }) {
  const { state, space, tab, actions } = useFilesWorkspaces(granted ? "page" : "page-limited", start);
  const home: FilesPlace = start;

  const tabs = (
    <div className="shrink-0 px-2 pt-1">
      <TabStrip
        label="Files tabs"
        tabs={space.tabs.map((each) => ({
          id: each.id,
          label: each.title,
          icon: each.kind === "transfers" ? <ArrowRightLeft /> : <Folder />,
          closeLabel: space.tabs.length > 1 ? `Close ${each.title}` : undefined,
          menu: (
            <>
              <MenuItem icon={Plus} label="New tab" onSelect={() => actions.newTab(home)} />
              {space.tabs.length > 1 ? <MenuItem label="Close tab" onSelect={() => actions.closeTab(each.id)} /> : null}
            </>
          ),
        }))}
        active={tab.id}
        onSelect={actions.selectTab}
        onClose={actions.closeTab}
        onReorder={actions.moveTab}
        after={
          <IconButton label="New tab" onClick={() => actions.newTab(home)}>
            <Plus />
          </IconButton>
        }
      />
    </div>
  );

  const switcher = <FilesWorkspaceSwitcher list={state.list} active={space} actions={actions} home={home} />;

  if (tab.kind === "transfers")
    return (
      <FilesFrame
        picking={false}
        tabs={tabs}
        sidebarTop={switcher}
        sidebar={<TransfersSidebar granted={granted} onGo={(place) => actions.newTab(place)} />}
        preview={false}
      >
        {() => <TransfersView />}
      </FilesFrame>
    );

  return (
    <FilesFrame picking={false} tabs={tabs} sidebarTop={switcher}>
      {(slots) => <TabPanes key={tab.id} tab={tab} granted={granted} slots={slots} actions={actions} />}
    </FilesFrame>
  );
}

/** A tab's panes side by side or stacked, parted by seams; the ones not in use are set back. One pane fills the tab alone. */
function TabPanes({
  tab,
  granted,
  slots,
  actions,
}: {
  tab: FilesTab;
  granted: boolean;
  slots: Parameters<typeof FilesPane>[0]["host"]["slots"];
  actions: ReturnType<typeof useFilesWorkspaces>["actions"];
}) {
  const panes = tab.panes.map((pane) => (
    <FilesPane
      key={pane.id}
      granted={granted}
      start={pane.place}
      host={{
        active: pane.id === tab.active,
        slots,
        count: tab.panes.length,
        onFocus: () => actions.focusPane(tab.id, pane.id),
        onPlace: (place, title) => actions.placePane(tab.id, pane.id, place, title),
        split: (direction) => actions.splitPane(tab.id, direction),
        close: () => actions.closePane(tab.id, pane.id),
        newTab: (place) => actions.newTab(place),
        transfers: actions.openTransfers,
      }}
    />
  ));
  if (panes.length === 1) return panes[0];
  const direction = tab.direction === "down" ? "vertical" : "horizontal";
  return (
    <SplitPanes direction={direction} autoSaveId={`files-panes-${direction}-${tab.panes.length}`} className="size-full">
      {tab.panes.map((pane, index) => (
        <Fragment key={pane.id}>
          {index > 0 ? <SplitHandle direction={direction} seam label="Resize the panes" /> : null}
          <SplitPane id={pane.id} order={index + 1} minSize={20}>
            {panes[index]}
          </SplitPane>
        </Fragment>
      ))}
    </SplitPanes>
  );
}
