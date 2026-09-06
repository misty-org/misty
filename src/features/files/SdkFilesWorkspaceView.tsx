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
import { MultiPanelWorkspace } from "@/features/workspace/MultiPanelWorkspace";
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
  const [preview, setPreview] = useState<FileEntry | null>(null);
  const [sizes, setSizes] = useState<Record<string, DirectorySizeRecord>>({});
  const [showTransfers, setShowTransfers] = useState(false);
  useEffect(
    () =>
      setShowTransfers(
        new URL(route ?? "/apps/files", "https://misty.local").searchParams.get("view") ===
          "transfers",
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
    const preview = createSdkFilesPreviewRuntime(files, { Error: ErrorView });
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
  const drop: FileBrowserProps["onDropItems"] = async (payload, path, storage, modifiers) => {
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
            const destination = (await services.resolvePath?.(props.path)) ?? props.path;
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
      Search: (props: Omit<Parameters<typeof ExplorerToolbarSearchView>[0], "runtime">) => (
        <ExplorerToolbarSearchView {...props} runtime={searchRuntime} />
      ),
    };
  }, [files, runtime, services]);
  const selected = files.selected();
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
    canCalculateDirectorySizes: selected.some((entry) => entry.kind === "folder"),
    onOpenWith: () => run(() => files.openExternal(selected[0].path)),
    onCalculateDirectorySizes: () =>
      run(async () => {
        for (const entry of selected.filter((entry) => entry.kind === "folder")) {
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
        misty.clipboard.writeText(sdkFilesPathPresentation(state.folders, path).displayPath),
      ),
    onDownload: () => run(() => services.download(selected)),
    pluginCommands: [],
    onRunCommand: (command) => run(() => services.runCommand(command)),
  });
  useEffect(() => {
    const element = root.current;
    if (!element || !model.active || !model.focused) return;
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (event.target instanceof Element &&
          event.target.closest("input,textarea,[contenteditable=true]"))
      )
        return;
      const mod = event.metaKey || event.ctrlKey;
      const actions: Record<string, (() => void) | undefined> = {
        c: toolbar.canCopy ? toolbar.onCopy : undefined,
        x: toolbar.canCut ? toolbar.onCut : undefined,
        v: toolbar.canPaste ? toolbar.onPaste : undefined,
        z: event.shiftKey
          ? toolbar.canRedo
            ? toolbar.onRedo
            : undefined
          : toolbar.canUndo
            ? toolbar.onUndo
            : undefined,
        a: () => {
          const entries = files.store.getState().pane.listing?.entries ?? [];
          files.clearSelection();
          entries.forEach((entry) => files.select(entry.id, { toggle: true }));
        },
        r: toolbar.onRefresh,
      };
      const action = mod
        ? actions[event.key.toLowerCase()]
        : event.key === "Backspace" || event.key === "Delete"
          ? toolbar.onDelete
          : event.key === "F2"
            ? toolbar.onRename
            : undefined;
      if (action) {
        event.preventDefault();
        action();
      }
    };
    element.addEventListener("keydown", keydown);
    return () => element.removeEventListener("keydown", keydown);
  }, [files, model.active, model.focused, toolbar]);
  const menuEntries = (entry: FileEntry | null): ContextMenuEntry[] => [
    ...(entry
      ? [
          {
            id: "open",
            icon: <FolderOpen size={15} />,
            label: "Open",
            onRun: () =>
              entry.kind === "folder" ? run(() => files.navigate(entry.path)) : openPreview(entry),
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
      label: toolbar.path === "misty://trash" ? "Delete permanently…" : "Move to Trash",
      disabled: !toolbar.canDelete,
      onRun: toolbar.onDelete,
    },
  ];
  return (
    <TooltipProvider>
      <div ref={root} className="h-full min-h-0 min-w-0" tabIndex={-1}>
        <ExplorerDragProviderView runtime={services.drag}>
          <FileBrowserRuntimeProvider value={runtime.browser}>
            <MultiPanelWorkspace
              store={workspace.multiPanel}
              showTabStrip={false}
              showDefaultPaneControls={false}
              renderToolbar={() => (
                <>
                  <ExplorerToolbarView {...toolbar} runtime={toolbarRuntime} />
                  <div className="flex min-w-0 items-center justify-between border-t border-charcoal-border px-2">
                    <ExplorerPaneToolbarActions {...toolbar} />
                    <div className="flex shrink-0 items-center">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Toggle sidebar"
                        aria-pressed={model.sidebarVisible}
                        title={model.sidebarVisible ? "Hide sidebar" : "Show sidebar"}
                        onClick={() =>
                          run(() => workspace.setSidebarVisible(!model.sidebarVisible))
                        }
                      >
                        <PanelLeft size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Toggle preview"
                        aria-pressed={model.previewVisible}
                        title={model.previewVisible ? "Hide preview" : "Show preview"}
                        onClick={() =>
                          run(() => workspace.setPreviewVisible(!model.previewVisible))
                        }
                      >
                        <PanelRight size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Open right panel"
                        onClick={() => run(() => workspace.openView(undefined, "right"))}
                      >
                        <Columns2 size={16} />
                      </Button>
                      <Button variant="ghost" onClick={() => setShowTransfers((value) => !value)}>
                        Transfers
                        {state.transfers.some((item) => item.status === "running")
                          ? " · Running"
                          : ""}
                      </Button>
                    </div>
                  </div>
                </>
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
                  workspace.setSidebarWidth(workspace.model.getState().sidebarWidth + delta),
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
                  workspace.setPreviewWidth(workspace.model.getState().previewWidth + delta),
                )
              }
              renderPane={() =>
                model.loading ? (
                  <div role="status" className="p-5 text-sm text-cream-muted">
                    Opening Files…
                  </div>
                ) : !state.pane.listing ? (
                  <div className="grid h-full place-content-center gap-3 text-center">
                    <FolderOpen className="mx-auto text-cream-muted" size={28} />
                    <p className="text-sm text-cream-muted">
                      Choose a folder to browse and edit its files.
                    </p>
                    <Button onClick={() => run(() => files.openFolder())}>Choose folder</Button>
                    {state.error && <runtime.Error error={state.error} />}
                  </div>
                ) : (
                  <SdkFilesPaneView
                    files={files}
                    paneId={paneId}
                    runtime={runtime.browser}
                    itemScale={state.itemScale}
                    directorySizes={sizes}
                    cutPaths={
                      new Set(state.clipboard?.operation === "move" ? state.clipboard.paths : [])
                    }
                    onOpenFile={openPreview}
                    onDropItems={drop}
                    menuEntries={menuEntries}
                  />
                )
              }
              renderBottomBar={() =>
                showTransfers ? (
                  <div className="max-h-44 overflow-auto border-t border-charcoal-border text-sm">
                    <div className="px-3 py-2 font-medium">Transfers</div>
                    {!state.transfers.length ? (
                      <p className="px-3 pb-3 text-cream-muted">No transfers in this view.</p>
                    ) : (
                      state.transfers.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 border-t border-charcoal-border px-3 py-2"
                        >
                          <span className="min-w-0 flex-1 truncate">{item.name}</span>
                          <span role="status" className="text-cream-muted">
                            {item.message}
                          </span>
                          {["queued", "running"].includes(item.status) ? (
                            <Button variant="ghost" onClick={() => files.cancelTransfer(item.id)}>
                              Cancel
                            </Button>
                          ) : ["failed", "cancelled"].includes(item.status) ? (
                            <Button
                              variant="ghost"
                              onClick={() => run(() => files.retryTransfer(item.id))}
                            >
                              Retry
                            </Button>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <div className="flex h-7 items-center gap-3 border-t border-charcoal-border px-3 text-xs text-cream-muted">
                    <span>
                      {state.pane.listing?.totalCount ?? 0}{" "}
                      {state.pane.listing?.totalCount === 1 ? "item" : "items"}
                    </span>
                    {selected.length > 0 && <span>{selected.length} selected</span>}
                    {state.busy && <span role="status">Working…</span>}
                  </div>
                )
              }
            />
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
