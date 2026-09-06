import { useState, type MouseEvent } from "react";
import type { FileEntry } from "@/native/contracts";
import { FileBrowserView } from "./explorer/components/FileBrowserView";
import {
  FileBrowserRuntimeProvider,
  type FileBrowserRuntime,
} from "./explorer/components/fileBrowser/FileBrowserRuntime";
import type { FileBrowserProps } from "./explorer/model/interfaces/components/FileBrowser";
import type { ContextMenuEntry } from "./explorer/model/types/workspace/ExplorerContextMenu";
import { ExplorerContextMenuView } from "./explorer/workspace/ExplorerContextMenuView";
import { ExplorerDeleteDialogView } from "./explorer/workspace/ExplorerDeleteDialogView";
import { BatchRenameDialogView } from "./explorer/workspace/BatchRenameDialogView";
import type { SdkFilesStore } from "./sdkFilesStore";

/** The shared file list/grid and editing controls, attached to one SDK-owned pane. */
export function SdkFilesPaneView(props: {
  files: SdkFilesStore;
  paneId: string;
  runtime: FileBrowserRuntime;
  itemScale: number;
  directorySizes: FileBrowserProps["directorySizes"];
  cutPaths: FileBrowserProps["cutPaths"];
  onOpenFile: (entry: FileEntry) => void;
  onDropItems: FileBrowserProps["onDropItems"];
  menuEntries: (entry: FileEntry | null) => ContextMenuEntry[];
}) {
  const { files } = props;
  const state = files.store();
  const { pane } = state;
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry | null } | null>(null);
  const openMenu = (event: MouseEvent, entry: FileEntry | null) => {
    event.preventDefault();
    event.stopPropagation();
    if (entry && !pane.selectedIds.includes(entry.id)) files.select(entry.id);
    if (!entry) files.clearSelection();
    setMenu({ x: event.clientX, y: event.clientY, entry });
  };
  return (
    <FileBrowserRuntimeProvider value={props.runtime}>
      <FileBrowserView
        paneId={props.paneId}
        listing={pane.listing}
        selectedIds={pane.selectedIds}
        loading={pane.loading}
        error={state.error}
        viewMode={state.viewMode}
        itemScale={props.itemScale}
        sort={state.sort}
        showHidden={state.showHidden}
        commandQuery={pane.commandQuery}
        commandQueryMode={pane.commandQueryMode}
        directorySizes={props.directorySizes}
        cutPaths={props.cutPaths}
        inlineEdit={state.inlineEdit}
        onSort={files.setSort}
        onToggleHidden={() => void files.toggleHidden().catch(files.error)}
        onSelect={(id, event, visibleEntryIds) =>
          files.select(id, {
            toggle: event.metaKey || event.ctrlKey,
            range: event.shiftKey,
            visibleEntryIds,
          })
        }
        onClearSelection={files.clearSelection}
        onOpen={(entry) =>
          entry.kind === "folder"
            ? void files.navigate(entry.path).catch(files.error)
            : props.onOpenFile(entry)
        }
        onContextMenu={openMenu}
        onBackgroundContextMenu={(event) => openMenu(event, null)}
        onDropItems={props.onDropItems}
        onInlineEditChange={files.updateInlineEdit}
        onInlineEditCommit={() => void files.commitInlineEdit().catch(files.error)}
        onInlineEditCancel={files.cancelInlineEdit}
      />
      {menu && (
        <ExplorerContextMenuView
          open
          x={menu.x}
          y={menu.y}
          menuEntries={props.menuEntries(menu.entry)}
          onClose={() => setMenu(null)}
        />
      )}
      {state.dialog?.kind === "batchRename" && (
        <BatchRenameDialogView
          dialog={state.dialog}
          onClose={files.closeDialog}
          onApply={files.applyBatchRename}
        />
      )}
      {state.dialog?.kind === "delete" && (
        <ExplorerDeleteDialogView
          paths={state.dialog.paths}
          onClose={files.closeDialog}
          onConfirm={files.confirmDelete}
        />
      )}
    </FileBrowserRuntimeProvider>
  );
}
