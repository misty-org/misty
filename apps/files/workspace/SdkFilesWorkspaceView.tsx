import { useSdkFilesShortcuts } from "./useSdkFilesShortcuts";
import { createSdkFilesDuplicates } from "./sdkFilesDuplicates";
import { DuplicateFinderDialogView } from "./explorer/workspace/ExplorerDuplicateFinderDialogView";
import { createSdkFilesCompareRuntime } from "./sdkFilesCompare";
import {
  CompareDialogView,
  type CompareDialogSeed,
} from "./explorer/workspace/ExplorerCompareDialogView";
import { createFilesAiAdapter } from "./createFilesAiAdapter";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MistyAppSDK } from "@misty/sdk";
import type { DirectorySizeRecord, FileEntry } from "@/native/contracts";
import { Button, TooltipProvider } from "@/shared/ui";
import {
  Columns2,
  Copy,
  FolderOpen,
  FolderPlus,
  PanelLeft,
  PanelRight,
  Pencil,
  Plus,
  RotateCcw,
  Rows2,
  Scissors,
  Star,
  Trash2,
} from "lucide-react";
import { MultiPanelWorkspaceView as MultiPanelWorkspace } from "@/features/workspace/MultiPanelWorkspaceView";
import type { SdkFilesWorkspace } from "./sdkFilesWorkspace";
import { SdkFilesPaneView } from "./SdkFilesPaneView";
import { useSdkFilesToolbarProps } from "./SdkFilesToolbar";
import { ExplorerToolbarView } from "./explorer/components/ExplorerToolbarView";
import { ExplorerPaneToolbarActions } from "./explorer/components/ExplorerPaneToolbarActions";
import { ExplorerSidebarView } from "./explorer/components/ExplorerSidebarView";
import { FileInspectorView } from "./explorer/components/FileInspectorView";
import { GlobalPreviewDialogView } from "./explorer/components/globalPreview/GlobalPreviewDialogView";
import { ExplorerToolbarSearchView } from "./explorer/components/ExplorerToolbarSearchView";
import { FileIcon } from "./explorer/components/FileBrowserIcons";
import { FileBrowserRuntimeProvider } from "./explorer/components/fileBrowser/FileBrowserRuntime";
import {
  ExplorerDragProviderView,
  type ExplorerDragRuntime,
} from "./explorer/drag/ExplorerDragProviderView";
import { Droppable } from "./explorer/drag/ExplorerDragHooks";
import { transferDropAcceptance } from "./explorer/components/FileBrowserDrag";
import type { FileBrowserProps } from "./explorer/model/interfaces/components/FileBrowser";
import type { ContextMenuEntry } from "./explorer/model/types/workspace/ExplorerContextMenu";
import type { ExplorerSidebarProps } from "./explorer/model/interfaces/components/ExplorerSidebar";
import type { ExplorerSidebarRuntime } from "./explorer/components/explorerSidebar/ExplorerSidebarRuntime";
import { createSdkFilesThumbnails } from "./sdkFilesThumbnails";
import { createSdkFilesPreviewRuntime } from "./sdkFilesPreview";
import { createSdkFilesInspector } from "./sdkFilesInspector";
import { createSdkFilesSearch } from "./sdkFilesSearch";
import { sdkFilesPathPresentation } from "./sdkFilesNavigation";

export interface SdkFilesWorkspaceServices {
  resolvePath?(path: string): Promise<string>;
  useSourceStatus?(): { error: string | null; loading: boolean };
  retrySources?(): Promise<void>;
  useSidebar(): ExplorerSidebarProps;
  sidebarRuntime: Omit<ExplorerSidebarRuntime, "DropTarget" | "Error">;
  drag: ExplorerDragRuntime;
  dropExternal: FileBrowserProps["onDropItems"];
  download(entries: FileEntry[]): Promise<void>;
  runCommand(command: string): Promise<void>;
}

export function SdkFilesWorkspaceView({
  workspace,
  misty,
  signal,
  services,
  route,
}: {
  workspace: SdkFilesWorkspace;
  misty: MistyAppSDK;
  signal: AbortSignal;
  services: SdkFilesWorkspaceServices;
  route?: string;
}) {
  const { files, paneId } = workspace;
  const state = files.store(),
    model = workspace.model(),
    history = files.history();
  const sidebar = services.useSidebar();
  const sourceStatus = services.useSourceStatus?.();
  const [duplicates, setDuplicates] = useState<string | null>(null);
  const [comparison, setComparison] = useState<CompareDialogSeed | null>(null);
  const [preview, setPreview] = useState<FileEntry | null>(null);
  const [sizes, setSizes] = useState<Record<string, DirectorySizeRecord>>({});
  const sharedRoots = new Set(model.sharedRoots);
  const [showTransfers, setShowTransfers] = useState(false);
  useEffect(
    () =>
      setShowTransfers(
        new URL(route ?? "/apps/files", "https://misty.local").searchParams.get(
          "view",
        ) === "transfers",
      ),
    [route],
  );
  const root = useRef<HTMLDivElement>(null);
  const run = (action: () => unknown) => {
    try {
      void Promise.resolve(action()).catch(files.error);
    } catch (error) {
      files.error(error);
    }
  };
  const runtime = useMemo(() => {
    function ErrorView({ error }: { error?: unknown }) {
      return (
        <div role="alert" className="px-3 py-2 text-sm text-cream">
          {String(error)}
          <Button
            className="ml-2"
            variant="ghost"
            onClick={() => void files.refresh().catch(files.error)}
          >
            Retry
          </Button>
        </div>
      );
    }
    const thumbnails = createSdkFilesThumbnails(files, signal);
    const preview = createSdkFilesPreviewRuntime(files, {
      Error: ErrorView,
      shortcuts: misty.shortcuts,
    });
    const search = createSdkFilesSearch(files, signal);
    return {
      Error: ErrorView,
      thumbnails,
      preview,
      search,
      inspector: createSdkFilesInspector(files, preview),
      browser: {
        thumbnailPreviewsEnabled: true,
        compactModeEnabled: false,
        ...thumbnails,
        Error: ErrorView,
      },
    };
  }, [files, signal]);
  useEffect(() => () => runtime.thumbnails.close(), [runtime]);
  const drop: FileBrowserProps["onDropItems"] = async (
    payload,
    path,
    storage,
    modifiers,
  ) => {
    if (payload.origin === "external")
      return services.dropExternal(payload, path, storage, modifiers);
    path = (await services.resolvePath?.(path)) ?? path;
    return files
      .transfer(
        payload.items.map((item) => item.path),
        path,
        modifiers.copyRequested ? "copy" : "move",
      )
      .then(() => undefined);
  };
  const toolbarRuntime = useMemo(() => {
    const DropTarget: ExplorerSidebarRuntime["DropTarget"] = (props) => (
      <Droppable
        className="contents"
        zone={{
          id: props.id,
          priority: 10,
          springLoad: props.springLoad,
          onSpringLoad: props.onSpringLoad,
          accepts: (payload) => transferDropAcceptance(payload, props.path),
          onDrop: async (payload, modifiers) => {
            if (payload.origin === "external")
              return services.dropExternal(payload, props.path, "", modifiers);
            const destination =
              (await services.resolvePath?.(props.path)) ?? props.path;
            await files.transfer(
              payload.items.map((item) => item.path),
              destination,
              modifiers.copyRequested ? "copy" : "move",
            );
          },
        }}
      >
        {props.children}
      </Droppable>
    );
    const searchRuntime = {
      query: runtime.search.query,
      openSearch: () => files.setQueryMode("search"),
      Error: runtime.Error,
      Thumbnail: ({
        result,
        className,
        imageClassName,
      }: {
        result: { entry: FileEntry };
        className: string;
        imageClassName: string;
      }) => {
        const [url, setUrl] = useState<string | null>(null);
        useEffect(
          () => runtime.thumbnails.requestThumbnail(result.entry, 112, setUrl),
          [result.entry],
        );
        return (
          <span className={className}>
            {url ? (
              <img src={url} alt="" className={imageClassName} />
            ) : (
              <FileIcon entry={result.entry} size={20} />
            )}
          </span>
        );
      },
    };
    return {
      DropTarget,
      Search: (
        props: Omit<Parameters<typeof ExplorerToolbarSearchView>[0], "runtime">,
      ) => <ExplorerToolbarSearchView {...props} runtime={searchRuntime} />,
    };
  }, [files, runtime, services]);
  const duplicatesRuntime = useMemo(
    () => createSdkFilesDuplicates(files, signal, runtime.Error),
    [files, signal, runtime],
  );
  const comparisonRuntime = useMemo(
    () =>
      createSdkFilesCompareRuntime(files, signal, {
        Error: runtime.Error,
        notify: () => {
          void files.refresh().catch(files.error);
        },
      }),
    [files, signal, runtime],
  );
  const selected = files.selected();
  const aiAdapter = useMemo(
    () =>
      createFilesAiAdapter({
        viewId: paneId,
        canMutate: true,
        selected: files.selected,
        rename: (entry, name) => files.rename(entry.path, name),
        trash: () => files.deleteSelected(),
      }),
    [files, paneId, state.pane],
  );
  useEffect(() => {
    if (!model.active || !model.focused || signal.aborted) return;
    let closed = false;
    let remove: (() => void) | undefined;
    void misty.surfaces
      .register(aiAdapter)
      .then((next) => {
        if (closed || signal.aborted) next();
        else remove = next;
      })
      .catch((error) => {
        if (!closed && !signal.aborted) files.error(error);
      });
    return () => {
      closed = true;
      remove?.();
    };
  }, [aiAdapter, misty, files, signal, model.active, model.focused]);

  const openPreview = (entry: FileEntry) => {
    files.recordRecent(entry);
    setPreview(entry);
  };
  const toolbar = useSdkFilesToolbarProps(files, paneId, {
    canUndo: !!history.undo.length && !state.busy,
    canRedo: !!history.redo.length && !state.busy,
    undoTitle: history.undo.slice(-1)[0]?.title ?? "Undo",
    redoTitle: history.redo.slice(-1)[0]?.title ?? "Redo",
    onUndo: () => run(files.undo),
    onRedo: () => run(files.redo),
    canOpenWithSelected: selected.length === 1 && selected[0].kind === "file",
    canCalculateDirectorySizes: selected.some(
      (entry) => entry.kind === "folder",
    ),
    onOpenWith: () => run(() => files.openExternal(selected[0].path)),
    onCalculateDirectorySizes: () =>
      run(async () => {
        for (const entry of selected.filter(
          (entry) => entry.kind === "folder",
        )) {
          setSizes((current) => ({
            ...current,
            [entry.path]: {
              path: entry.path,
              sizeBytes: null,
              status: "calculating",
              calculatedAtMs: null,
            },
          }));
          try {
            const bytes = await runtime.search.size(entry.path, signal);
            if (!signal.aborted)
              setSizes((current) => ({
                ...current,
                [entry.path]: {
                  path: entry.path,
                  sizeBytes: bytes,
                  status: "ready",
                  calculatedAtMs: Date.now(),
                },
              }));
          } catch (error) {
            if (!signal.aborted)
              setSizes((current) => ({
                ...current,
                [entry.path]: {
                  path: entry.path,
                  sizeBytes: null,
                  status: "failed",
                  calculatedAtMs: null,
                  error: String(error),
                },
              }));
            throw error;
          }
        }
      }),
    onCopyPath: (path) =>
      run(() =>
        misty.clipboard.writeText(
          sdkFilesPathPresentation(state.folders, path).displayPath,
        ),
      ),
    onDownload: () => run(() => services.download(selected)),
    pluginCommands: [],
    onRunCommand: (command) => run(() => services.runCommand(command)),
  });
  useSdkFilesShortcuts(
    misty,
    model.active && model.focused && !comparison && !duplicates && !preview,
    {
      "explorer.new_folder": toolbar.canCreateFolder
        ? toolbar.onCreateFolder
        : undefined,
      "explorer.search": () => files.setQueryMode("search"),
      "explorer.copy": toolbar.canCopy ? toolbar.onCopy : undefined,
      "explorer.cut": toolbar.canCut ? toolbar.onCut : undefined,
      "explorer.paste": toolbar.canPaste ? toolbar.onPaste : undefined,
      "explorer.rename": toolbar.canRename ? toolbar.onRename : undefined,
      "explorer.batch_rename":
        toolbar.canRename || selected.length > 1
          ? () => files.startBatchRename(paneId)
          : undefined,
      "explorer.delete": toolbar.canDelete ? toolbar.onDelete : undefined,
      "explorer.download": selected.length ? toolbar.onDownload : undefined,
      "explorer.open_with": toolbar.canOpenWithSelected
        ? toolbar.onOpenWith
        : undefined,
      "explorer.copy_path": () =>
        toolbar.onCopyPath(selected[0]?.path ?? toolbar.path),
      "explorer.undo": toolbar.canUndo ? toolbar.onUndo : undefined,
      "explorer.redo": toolbar.canRedo ? toolbar.onRedo : undefined,
      "explorer.refresh": toolbar.onRefresh,
      "explorer.toggle_hidden": toolbar.onToggleHidden,
      "explorer.preview.toggle": () =>
        workspace.setPreviewVisible(!model.previewVisible),
      "explorer.sidebar.toggle": () =>
        workspace.setSidebarVisible(!model.sidebarVisible),
      "explorer.duplicate_finder": () => {
        if (state.pane.listing) setDuplicates(state.pane.listing.path);
      },
      "explorer.compare_with": () => {
        if (selected[0])
          setComparison({
            paneId,
            leftPath: selected[0].path,
            rightPath:
              selected[1]?.kind === selected[0].kind
                ? selected[1].path
                : undefined,
            mode: selected[0].kind === "folder" ? "folder" : "file",
          });
      },
    },
    files.error,
  );
  useEffect(() => {
    const element = root.current;
    if (!element || !model.active || !model.focused) return;
    const selectAll = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "a" ||
        (event.target instanceof Element &&
          event.target.closest("input,textarea,[contenteditable=true]"))
      )
        return;
      event.preventDefault();
      files.clearSelection();
      files.store
        .getState()
        .pane.listing?.entries.forEach((entry) =>
          files.select(entry.id, { toggle: true }),
        );
    };
    element.addEventListener("keydown", selectAll);
    return () => element.removeEventListener("keydown", selectAll);
  }, [files, model.active, model.focused]);
  const menuEntries = (entry: FileEntry | null): ContextMenuEntry[] => [
    ...(!entry &&
    state.pane.listing &&
    state.folders.some(
      (folder) =>
        (!folder.source || folder.source.kind === "local") &&
        (state.pane.listing!.path === folder.root ||
          state.pane.listing!.path.startsWith(folder.root + "/")),
    )
      ? [
          {
            id: "share-folder",
            icon: <FolderOpen size={15} />,
            label: `${sharedRoots.has(files.owner(state.pane.listing!.path).root) ? "Stop sharing" : "Share"} ${files.owner(state.pane.listing!.path).name} with my devices in this Space`,
            onRun: () => run(async () => {
              const folder = files.owner(state.pane.listing!.path);
              const shared = !sharedRoots.has(folder.root);
              await folder.shareForPeers(shared);
              workspace.model.setState(state => ({ sharedRoots: shared ? [...new Set([...state.sharedRoots, folder.root])] : state.sharedRoots.filter(root => root !== folder.root) }));
              await services.retrySources?.();
            }),
          },
          {
            id: "reindex",
            icon: <RotateCcw size={15} />,
            label: "Rebuild search index",
            onRun: () =>
              run(() =>
                runtime.search.rebuild(state.pane.listing!.path, signal),
              ),
          },
        ]
      : []),
    ...(entry?.kind === "folder" ||
    (!entry &&
      !["misty://recent", "misty://starred", "misty://trash"].includes(
        state.pane.listing?.path ?? "",
      ) &&
      state.pane.listing)
      ? [
          {
            id: "duplicates",
            icon: <Copy size={15} />,
            label: "Find duplicates",
            onRun: () => setDuplicates(entry?.path ?? state.pane.listing!.path),
          },
        ]
      : []),
    ...(selected.length === 2 &&
    selected[0].kind === selected[1].kind &&
    ["file", "folder"].includes(selected[0].kind)
      ? [
          {
            id: "compare",
            icon: <Columns2 size={15} />,
            label: "Compare selected items",
            onRun: () =>
              setComparison({
                paneId,
                leftPath: selected[0].path,
                rightPath: selected[1].path,
                mode: selected[0].kind === "folder" ? "folder" : "file",
              }),
          },
        ]
      : []),
    ...(entry
      ? [
          {
            id: "open",
            icon: <FolderOpen size={15} />,
            label: "Open",
            onRun: () =>
              entry.kind === "folder"
                ? run(() => files.navigate(entry.path))
                : openPreview(entry),
          },
        ]
      : []),
    ...(entry?.kind === "folder"
      ? [
          {
            id: "tab",
            icon: <Plus size={15} />,
            label: "Open in new tab",
            onRun: () => run(() => workspace.openView(entry.path)),
          },
          {
            id: "right",
            icon: <Columns2 size={15} />,
            label: "Open in right panel",
            onRun: () => run(() => workspace.openView(entry.path, "right")),
          },
          {
            id: "bottom",
            icon: <Rows2 size={15} />,
            label: "Open in bottom panel",
            onRun: () => run(() => workspace.openView(entry.path, "down")),
          },
        ]
      : []),
    ...(entry
      ? [
          {
            id: "star",
            icon: <Star size={15} />,
            label: state.starred.some((item) => item.path === entry.path)
              ? "Remove from Starred"
              : "Add to Starred",
            onRun: () => files.toggleStar(entry),
          },
        ]
      : []),
    {
      id: "create",
      icon: <FolderPlus size={15} />,
      label: "New folder",
      disabled: !toolbar.canCreateFolder,
      onRun: toolbar.onCreateFolder,
    },
    {
      id: "copy",
      icon: <Copy size={15} />,
      label: "Copy",
      disabled: !toolbar.canCopy,
      onRun: toolbar.onCopy,
    },
    {
      id: "cut",
      icon: <Scissors size={15} />,
      label: "Cut",
      disabled: !toolbar.canCut,
      onRun: toolbar.onCut,
    },
    {
      id: "paste",
      icon: <Copy size={15} />,
      label: "Paste",
      disabled: !toolbar.canPaste,
      onRun: toolbar.onPaste,
    },
    {
      id: "rename",
      icon: <Pencil size={15} />,
      label: "Rename",
      disabled: !toolbar.canRename,
      onRun: toolbar.onRename,
    },
    {
      id: "batch-rename",
      icon: <Pencil size={15} />,
      label: "Batch rename",
      disabled: !toolbar.canRename,
      onRun: () => files.startBatchRename(paneId),
    },
    ...(toolbar.onRestore
      ? [
          {
            id: "restore",
            icon: <RotateCcw size={15} />,
            label: "Restore",
            disabled: !toolbar.canRestore,
            onRun: toolbar.onRestore,
          },
        ]
      : []),
    {
      id: "delete",
      icon: <Trash2 size={15} />,
      label:
        toolbar.path === "misty://trash"
          ? "Delete permanently…"
          : "Move to Trash",
      disabled: !toolbar.canDelete,
      onRun: toolbar.onDelete,
    },
  ];
  return (
    <TooltipProvider>
      <div
        ref={root}
        className="flex h-full min-h-0 min-w-0 flex-col"
        tabIndex={-1}
      >
        <ExplorerDragProviderView runtime={services.drag}>
          <FileBrowserRuntimeProvider value={runtime.browser}>
            {model.restoreErrors.length > 0 && (
              <div
                role="alert"
                className="flex items-center gap-3 border-b border-charcoal-border px-3 py-2 text-sm text-cream-muted"
              >
                <span className="min-w-0 flex-1">
                  Some saved folders could not reopen. {model.restoreErrors[0]}
                </span>
                <Button
                  variant="ghost"
                  onClick={() =>
                    run(async () => {
                      await workspace.retryRestore();
                      await services.retrySources?.();
                    })
                  }
                >
                  Retry saved folders
                </Button>
              </div>
            )}
            {sourceStatus?.error && (
              <div
                role="alert"
                className="flex items-center gap-3 border-b border-charcoal-border px-3 py-2 text-sm text-cream-muted"
              >
                <span className="min-w-0 flex-1">
                  Couldn’t load file sources: {sourceStatus.error}
                </span>
                <Button
                  variant="ghost"
                  onClick={() => run(() => services.retrySources?.())}
                >
                  Retry
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => run(() => files.openFolder())}
                >
                  Choose folder
                </Button>
              </div>
            )}
            <div className="min-h-0 flex-1">
              <MultiPanelWorkspace
                store={workspace.multiPanel}
                showTabStrip={false}
                showDefaultPaneControls={false}
                renderToolbar={() => (
                  <ExplorerToolbarView {...toolbar} runtime={toolbarRuntime} />
                )}
                renderNavigationAside={
                  model.sidebarVisible ? (
                    <ExplorerSidebarView
                      {...sidebar}
                      runtime={{
                        ...services.sidebarRuntime,
                        Error: runtime.Error,
                        DropTarget: toolbarRuntime.DropTarget,
                      }}
                    />
                  ) : undefined
                }
                navigationAsideWidth={model.sidebarWidth}
                onNavigationAsideResizeBy={(delta) =>
                  run(() =>
                    workspace.setSidebarWidth(
                      workspace.model.getState().sidebarWidth + delta,
                    ),
                  )
                }
                renderAside={
                  model.previewVisible ? (
                    <FileInspectorView
                      runtime={runtime.inspector}
                      listing={state.pane.listing}
                      selectedEntry={selected[0] ?? null}
                      selectedCount={selected.length}
                      directorySizes={sizes}
                      onOpenEntry={(entry) =>
                        entry.kind === "folder"
                          ? run(() => files.navigate(entry.path))
                          : openPreview(entry)
                      }
                      onPreviewSaved={files.refresh}
                    />
                  ) : undefined
                }
                asideWidth={model.previewWidth}
                onAsideResizeBy={(delta) =>
                  run(() =>
                    workspace.setPreviewWidth(
                      workspace.model.getState().previewWidth + delta,
                    ),
                  )
                }
                renderPane={() =>
                  model.loading ? (
                    <div role="status" className="p-5 text-sm text-cream-muted">
                      Opening Files…
                    </div>
                  ) : !state.pane.listing ? (
                    <div className="grid h-full place-content-center gap-3 text-center">
                      <FolderOpen
                        className="mx-auto text-cream-muted"
                        size={28}
                      />
                      <p className="text-sm text-cream-muted">
                        Choose a folder to browse and edit its files.
                      </p>
                      <Button onClick={() => run(() => files.openFolder())}>
                        Choose folder
                      </Button>
                      {state.error && <runtime.Error error={state.error} />}
                    </div>
                  ) : (
                    <div className="grid h-full min-h-0 grid-rows-[38px_minmax(0,1fr)] overflow-hidden">
                      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-charcoal-border/60 bg-charcoal-sidebar px-3 text-xs text-cream-muted">
                        <span className="min-w-0 truncate">
                          {state.pane.listing?.title}
                        </span>
                        <ExplorerPaneToolbarActions {...toolbar} />
                      </div>
                      <div className="min-h-0 overflow-hidden">
                        <SdkFilesPaneView
                          files={files}
                          paneId={paneId}
                          runtime={runtime.browser}
                          itemScale={state.itemScale}
                          directorySizes={sizes}
                          cutPaths={
                            new Set(
                              state.clipboard?.operation === "move"
                                ? state.clipboard.paths
                                : [],
                            )
                          }
                          onOpenFile={openPreview}
                          onDropItems={drop}
                          menuEntries={menuEntries}
                        />
                      </div>
                    </div>
                  )
                }
                renderBottomBar={() => (
                  <>
                    {showTransfers ? (
                      <div className="max-h-44 overflow-auto border-t border-charcoal-border text-sm">
                        <div className="px-3 py-2 font-medium">Transfers</div>
                        {!state.transfers.length ? (
                          <p className="px-3 pb-3 text-cream-muted">
                            No transfers in this view.
                          </p>
                        ) : (
                          state.transfers.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center gap-3 border-t border-charcoal-border px-3 py-2"
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {item.name}
                              </span>
                              <span role="status" className="text-cream-muted">
                                {item.message}
                              </span>
                              {["queued", "running"].includes(item.status) ? (
                                <Button
                                  variant="ghost"
                                  onClick={() => files.cancelTransfer(item.id)}
                                >
                                  Cancel
                                </Button>
                              ) : ["failed", "cancelled"].includes(
                                  item.status,
                                ) ? (
                                <Button
                                  variant="ghost"
                                  onClick={() =>
                                    run(() => files.retryTransfer(item.id))
                                  }
                                >
                                  Retry
                                </Button>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>
                    ) : null}
                    <div className="flex h-8 items-center gap-3 border-t border-charcoal-border px-3 text-xs text-cream-muted">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Toggle sidebar"
                        aria-pressed={model.sidebarVisible}
                        title={
                          model.sidebarVisible ? "Hide sidebar" : "Show sidebar"
                        }
                        onClick={() =>
                          run(() =>
                            workspace.setSidebarVisible(!model.sidebarVisible),
                          )
                        }
                      >
                        <PanelLeft size={16} />
                      </Button>
                      <span>
                        {state.pane.listing?.totalCount ?? 0}{" "}
                        {state.pane.listing?.totalCount === 1
                          ? "item"
                          : "items"}
                      </span>
                      {selected.length > 0 && (
                        <span>{selected.length} selected</span>
                      )}
                      {state.busy && <span role="status">Working…</span>}
                      <div className="ml-auto">
                        <div className="flex shrink-0 items-center">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Toggle preview"
                            aria-pressed={model.previewVisible}
                            title={
                              model.previewVisible
                                ? "Hide preview"
                                : "Show preview"
                            }
                            onClick={() =>
                              run(() =>
                                workspace.setPreviewVisible(
                                  !model.previewVisible,
                                ),
                              )
                            }
                          >
                            <PanelRight size={16} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Open right panel"
                            onClick={() =>
                              run(() => workspace.openView(undefined, "right"))
                            }
                          >
                            <Columns2 size={16} />
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              run(() =>
                                misty.navigation.open(
                                  "/apps/files?view=transfers",
                                ),
                              )
                            }
                          >
                            Transfers
                            {state.transfers.some(
                              (item) => item.status === "running",
                            )
                              ? " · Running"
                              : ""}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              />
            </div>
            {duplicates && (
              <DuplicateFinderDialogView
                paneId={paneId}
                defaultRoot={duplicates}
                runtime={duplicatesRuntime}
                onClose={() => setDuplicates(null)}
              />
            )}
            {comparison && (
              <CompareDialogView
                seed={comparison}
                runtime={comparisonRuntime}
                onClose={() => setComparison(null)}
              />
            )}
            {preview && (
              <GlobalPreviewDialogView
                runtime={runtime.preview}
                source={preview}
                onClose={() => setPreview(null)}
                onSaved={files.refresh}
              />
            )}
          </FileBrowserRuntimeProvider>
        </ExplorerDragProviderView>
      </div>
    </TooltipProvider>
  );
}
