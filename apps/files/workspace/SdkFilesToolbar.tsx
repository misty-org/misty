import { resolveSdkFilesPath, sdkFilesPathPresentation } from "./sdkFilesNavigation";
import type {
  ExplorerToolbarProps,
  ExplorerPaneToolbarActionsProps,
} from "./explorer/model/interfaces/components/ExplorerToolbarModel";
import type { ExplorerToolbarRuntime } from "./explorer/components/ExplorerToolbarRuntime";
import { ExplorerToolbarView } from "./explorer/components/ExplorerToolbarView";
import type { SdkFilesStore } from "./sdkFilesStore";

/** Workspace services which live outside the local directory controller. */
export type SdkFilesToolbarServices = Pick<
  ExplorerToolbarProps,
  | "canUndo"
  | "canRedo"
  | "undoTitle"
  | "redoTitle"
  | "onUndo"
  | "onRedo"
  | "canOpenWithSelected"
  | "canCalculateDirectorySizes"
  | "onOpenWith"
  | "onCalculateDirectorySizes"
  | "onCopyPath"
  | "onDownload"
  | "pluginCommands"
  | "onRunCommand"
>;

export function useSdkFilesToolbarProps(
  files: SdkFilesStore,
  paneId: string,
  services: SdkFilesToolbarServices,
): ExplorerToolbarProps & ExplorerPaneToolbarActionsProps {
  const state = files.store(),
    { pane } = state;
  const selected =
    pane.listing?.entries.filter((entry) => pane.selectedIds.includes(entry.id)) ?? [];
  const path = pane.listing?.path ?? "";
  const inTrash = path === "misty://trash";
  const locations = [
    ...state.folders,
    ...state.trashItems
      .filter((item) => item.entry.kind === "folder")
      .map((item) => ({ root: item.entry.path, name: item.entry.name })),
  ];
  const run = (action: () => unknown) => () => {
    try {
      void Promise.resolve(action()).catch(files.error);
    } catch (error) {
      files.error(error);
    }
  };
  const canCreate =
    !!path &&
    !inTrash &&
    !state.busy &&
    !state.inlineEdit &&
    state.folders.some(
      (folder) => folder.writable && (path === folder.root || path.startsWith(`${folder.root}/`)),
    );
  const props: ExplorerToolbarProps & ExplorerPaneToolbarActionsProps = {
    ...services,
    paneId,
    path,
    ...sdkFilesPathPresentation(locations, path),
    pathPlaceholder: "Path within a chosen folder",
    commandQuery: pane.commandQuery,
    commandQueryMode: pane.commandQueryMode,
    viewMode: state.viewMode,
    itemScale: state.itemScale,
    onItemScale: files.setItemScale,
    sort: state.sort,
    showHidden: state.showHidden,
    selectedCount: selected.length,
    selectedEntryPath: selected.length === 1 ? selected[0].path : null,
    hasRemoteSelection: selected.some((entry) => entry.location.kind === "remote"),
    locationResults: [
      ...state.folders.map((folder) => ({
        id: folder.root,
        label: folder.name,
        path: folder.root,
        subtitle: "Chosen folder",
        badge: "Folder",
      })),
      {
        id: "trash",
        label: "Trash",
        path: "misty://trash",
        subtitle: "Deleted files",
        badge: "Files",
      },
    ],
    onNavigate: (path) => run(() => files.navigate(path))(),
    onNavigateLocation: (input) =>
      run(() => files.navigate(resolveSdkFilesPath(locations, path, input)))(),
    onNavigateSearchResult: (target) =>
      run(async () => {
        await files.navigate(target.path);
        if (target.selectEntryId && files.store.getState().pane.listing?.path === target.path)
          files.select(target.selectEntryId);
      })(),
    backPath: pane.backHistory.slice(-1)[0] ?? null,
    forwardPath: pane.forwardHistory.slice(-1)[0] ?? null,
    parentPath: pane.listing?.parentPath ?? null,
    canCut: selected.length > 0 && selected.every((entry) => !entry.readonly) && !state.busy,
    canCopy: selected.length > 0 && !state.busy,
    canPaste: canCreate && !!state.clipboard,
    canRename:
      !inTrash && selected.length > 0 && selected.every((entry) => !entry.readonly) && !state.busy,
    canDelete: selected.length > 0 && selected.every((entry) => !entry.readonly) && !state.busy,
    canRestore: selected.length > 0 && !state.busy,
    onRestore: inTrash ? run(() => files.restoreSelected()) : undefined,
    canCreateFile: canCreate,
    canCreateFolder: canCreate,
    onBack: run(files.back),
    onForward: run(files.forward),
    onParent: run(files.parent),
    onCommandQuery: files.setQuery,
    onCommandQueryMode: files.setQueryMode,
    onViewMode: files.setViewMode,
    onCreateFile: run(() => files.startInlineCreate("file", paneId)),
    onCreateFolder: run(() => files.startInlineCreate("folder", paneId)),
    onCut: run(() => files.copy("move")),
    onCopy: run(() => files.copy("copy")),
    onPaste: run(() => files.paste()),
    onRename: run(() => files.startInlineRename(paneId)),
    onDelete: run(() => files.deleteSelected(paneId)),
    onSort: files.setSort,
    onToggleHidden: run(files.toggleHidden),
    onRefresh: run(files.refresh),
    onRunCommand: (command) => {
      const local: Record<string, () => void> = {
        "explorer.new_folder": props.onCreateFolder,
        "explorer.copy": props.onCopy,
        "explorer.cut": props.onCut,
        "explorer.paste": props.onPaste,
        "explorer.rename": props.onRename,
        "explorer.batch_rename": run(() => files.startBatchRename(paneId)),
        "explorer.delete": props.onDelete,
        "explorer.refresh": props.onRefresh,
        "explorer.toggle_hidden": props.onToggleHidden,
        "explorer.undo": props.onUndo,
        "explorer.redo": props.onRedo,
      };
      const action = local[command];
      if (action) action();
      else services.onRunCommand(command);
    },
  };
  return props;
}

export function SdkFilesToolbar(props: {
  files: SdkFilesStore;
  paneId: string;
  runtime: ExplorerToolbarRuntime;
  services: SdkFilesToolbarServices;
}) {
  const toolbar = useSdkFilesToolbarProps(props.files, props.paneId, props.services);
  return <ExplorerToolbarView {...toolbar} runtime={props.runtime} />;
}
