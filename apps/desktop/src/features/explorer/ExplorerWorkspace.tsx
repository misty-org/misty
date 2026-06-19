import {
  AppWindow,
  Clipboard,
  Copy,
  FilePlus,
  Eye,
  FolderPlus,
  GitCompareArrows,
  PanelLeft,
  PanelRight,
  Pencil,
  Pin,
  RefreshCcw,
  Scissors,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, PointerEvent } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useShallow } from "zustand/react/shallow";
import { MultiPanelWorkspace } from "../../shared/multipanel/MultiPanelWorkspace";
import { useAppStore } from "../../app/useAppStore";
import { ExplorerPane } from "./components/ExplorerPane";
import { ExplorerSidebar } from "./components/ExplorerSidebar";
import { ExplorerToolbar } from "./components/ExplorerToolbar";
import type { ExplorerCommandId } from "./components/ExplorerToolbar";
import { FileInspector } from "./components/FileInspector";
import {
  explorerWorkspaceNeedsSave,
  scheduleExplorerWorkspaceSave,
  selectedEntryForPane,
  useExplorerStore,
} from "./state/useExplorerStore";
import { useMultiPanelStore } from "../../shared/multipanel/useMultiPanelStore";
import { useProvidersStore } from "../providers/useProvidersStore";
import type { FileSyncEndpoint, FileSyncPlannedAction, ProviderRemote } from "../../api/types";
import type { MultiPanelTab } from "../../shared/multipanel/types";
import { useFileSyncStore } from "./state/useFileSyncStore";

const minSidebarWidth = 212;
const maxSidebarWidth = 380;
const minPreviewWidth = 240;
const maxPreviewWidth = 420;
const folderHoverOpenDelayMs = 3000;
const emptyPinnedPaths: string[] = [];
const emptyProviderRemotes: ProviderRemote[] = [];

type ResizeTarget = "sidebar" | "preview" | null;
type ExternalDropTarget = {
  paneId: string;
  destination: string;
  kind: "directory" | "folder" | "unknown";
};

export function ExplorerWorkspace() {
  const app = useAppStore((state) => state.app);
  const {
    initialize,
    sidebarVisible,
    previewVisible,
    sidebarWidth,
    previewWidth,
    pinnedPaths,
    operationError,
  } = useExplorerStore(useShallow((state) => ({
    initialize: state.initialize,
    sidebarVisible: state.sidebarVisible,
    previewVisible: state.previewVisible,
    sidebarWidth: state.sidebarWidth,
    previewWidth: state.previewWidth,
    pinnedPaths: state.pinnedPaths,
    operationError: state.operationError,
  })));
  const providers = useProvidersStore((state) => state.providers);
  const providersLoading = useProvidersStore((state) => state.loading);
  const activePaneId = useMultiPanelStore((state) => state.activePaneId);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingResizeXRef = useRef(0);
  const externalHoverTimerRef = useRef<number | null>(null);
  const externalHoverTargetRef = useRef<string | null>(null);
  const transferRefreshInFlightRef = useRef(false);
  const [resizeTarget, setResizeTarget] = useState<ResizeTarget>(null);
  const homePath = app?.environment.homeDir ?? "/";
  const mountRoot = resolveMountRoot(homePath, app?.environment.mountPath ?? ".misty/mnt");
  const activePath = useExplorerStore((state) => state.panes[activePaneId]?.listing?.path ?? homePath);
  const sidebarRemotes = providers?.remotes ?? emptyProviderRemotes;
  const workspaceStyle = {
    "--explorer-sidebar-width": `${sidebarWidth}px`,
    "--preview-width": `${previewWidth}px`,
  } as CSSProperties;

  useEffect(() => {
    if (app?.environment.homeDir) {
      void initialize(app.environment.homeDir);
    }
  }, [app?.environment.homeDir, initialize]);

  useEffect(() => {
    const unsubscribeExplorer = useExplorerStore.subscribe((state, previous) => {
      if (explorerWorkspaceNeedsSave(state, previous)) scheduleExplorerWorkspaceSave();
    });
    const unsubscribeMulti = useMultiPanelStore.subscribe((state, previous) => {
      if (multiPanelWorkspaceNeedsSave(state, previous)) scheduleExplorerWorkspaceSave();
    });
    return () => {
      unsubscribeExplorer();
      unsubscribeMulti();
    };
  }, []);

  useEffect(() => {
    const poll = async () => {
      if (document.hidden || transferRefreshInFlightRef.current || !useExplorerStore.getState().initialized) return;
      transferRefreshInFlightRef.current = true;
      try {
        await useExplorerStore.getState().pollTransferRefreshes(mountRoot);
      } finally {
        transferRefreshInFlightRef.current = false;
      }
    };
    void poll();
    const interval = window.setInterval(poll, 2500);
    return () => window.clearInterval(interval);
  }, [mountRoot]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select, [contenteditable='true']") ?? false;
      const primary = event.metaKey || event.ctrlKey;
      const explorerState = useExplorerStore.getState();
      const multi = useMultiPanelStore.getState();
      const paneId = multi.activePaneId;
      if (!paneId) return;

      if (event.key === "Escape") {
        explorerState.cancelInlineEdit();
        explorerState.closeContextMenu();
        return;
      }
      if (editing) return;

      if (primary && event.code === "KeyC") {
        event.preventDefault();
        explorerState.copySelected(paneId);
      } else if (primary && event.code === "KeyX") {
        event.preventDefault();
        explorerState.cutSelected(paneId);
      } else if (primary && event.code === "KeyV") {
        event.preventDefault();
        void explorerState.pasteIntoPane(paneId);
      } else if (primary && event.code === "KeyR") {
        event.preventDefault();
        void explorerState.refreshPane(paneId);
      } else if (primary && event.code === "KeyT" && event.shiftKey) {
        event.preventDefault();
        multi.restoreTab();
      } else if (primary && event.code === "KeyT") {
        event.preventDefault();
        const activeTab = multi.tabs.find((tab) => tab.id === multi.activeTabId);
        multi.addTab(activeTab?.path ?? homePath, activeTab?.title);
      } else if (primary && event.code === "KeyW") {
        event.preventDefault();
        const activeTab = multi.tabs.find((tab) => tab.id === multi.activeTabId);
        if (activeTab && activeTab.panes.length > 1) multi.closePane(paneId);
        else if (activeTab) multi.closeTab(activeTab.id);
      } else if (primary && event.code === "Backslash") {
        event.preventDefault();
        multi.splitPane(paneId, event.shiftKey ? "horizontal" : "vertical");
      } else if (primary && /^Digit[1-9]$/.test(event.code)) {
        event.preventDefault();
        const index = Number(event.code.slice(-1)) - 1;
        const tab = multi.tabs[index];
        if (tab) multi.selectTab(tab.id);
      } else if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        void explorerState.navigateBack(paneId);
      } else if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        void explorerState.navigateForward(paneId);
      } else if (event.key === "F2") {
        event.preventDefault();
        void explorerState.renameSelected(paneId);
      } else if (event.key === "Delete" || (event.metaKey && event.key === "Backspace")) {
        event.preventDefault();
        void explorerState.deleteSelected(paneId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [homePath]);

  useEffect(() => {
    if (!resizeTarget) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const applyResize = () => {
      resizeFrameRef.current = null;
      const clientX = pendingResizeXRef.current;
      if (resizeTarget === "sidebar") {
        const rect = workspaceRef.current?.getBoundingClientRect();
        if (rect) useExplorerStore.getState().setSidebarWidth(clamp(clientX - rect.left, minSidebarWidth, maxSidebarWidth));
      } else {
        const rect = mainRef.current?.getBoundingClientRect();
        if (rect) useExplorerStore.getState().setPreviewWidth(clamp(rect.right - clientX, minPreviewWidth, maxPreviewWidth));
      }
    };

    const onPointerMove = (event: globalThis.PointerEvent) => {
      pendingResizeXRef.current = event.clientX;
      if (resizeFrameRef.current === null) resizeFrameRef.current = window.requestAnimationFrame(applyResize);
    };

    const onPointerUp = () => setResizeTarget(null);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [resizeTarget]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const clearExternalHover = () => {
      if (externalHoverTimerRef.current !== null) {
        window.clearTimeout(externalHoverTimerRef.current);
        externalHoverTimerRef.current = null;
      }
      externalHoverTargetRef.current = null;
    };
    const scheduleExternalHover = (target: ExternalDropTarget | null) => {
      if (!target || target.kind !== "folder" || !target.destination || target.destination === activePath) {
        clearExternalHover();
        return;
      }
      const key = `${target.paneId}\n${target.destination}`;
      if (externalHoverTargetRef.current === key) return;
      clearExternalHover();
      externalHoverTargetRef.current = key;
      externalHoverTimerRef.current = window.setTimeout(() => {
        externalHoverTimerRef.current = null;
        const latestPath = useExplorerStore.getState().panes[target.paneId]?.listing?.path;
        if (latestPath !== target.destination) {
          void useExplorerStore.getState().navigatePane(target.paneId, target.destination);
        }
      }, folderHoverOpenDelayMs);
    };
    void getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "leave") {
        clearExternalHover();
        return;
      }
      if (payload.type === "over") {
        scheduleExternalHover(externalDropTargetAt(payload.position, activePaneId, activePath));
        return;
      }
      if (payload.type !== "drop" || payload.paths.length === 0) return;
      clearExternalHover();
      const target = externalDropTargetAt(payload.position, activePaneId, activePath);
      if (!target) return;
      void useExplorerStore.getState().dropExternalPaths(target.paneId, payload.paths, target.destination);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    }).catch((error) => {
      useExplorerStore.setState({ operationError: `External drop unavailable: ${String(error)}` });
    });
    return () => {
      disposed = true;
      clearExternalHover();
      unlisten?.();
    };
  }, [activePaneId, activePath]);

  const startSidebarResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setResizeTarget("sidebar");
  }, []);

  const startPreviewResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setResizeTarget("preview");
  }, []);
  const navigateSidebar = useCallback((path: string) => {
    const paneId = useMultiPanelStore.getState().activePaneId;
    if (paneId) void useExplorerStore.getState().navigatePane(paneId, path);
  }, []);

  const renderToolbar = useCallback(
    (paneId: string, path: string) => <ConnectedExplorerToolbar paneId={paneId} fallbackPath={path} />,
    [],
  );
  const renderPane = useCallback((paneId: string, path: string) => <ExplorerPane paneId={paneId} path={path} />, []);
  const inspector = useMemo(() => (previewVisible ? <ConnectedFileInspector /> : undefined), [previewVisible]);
  const renderContextHeader = useCallback(
    (tab: MultiPanelTab) => tab.mode === "compare" ? <FileSyncCompareBar tab={tab} mountRoot={mountRoot} /> : null,
    [mountRoot],
  );

  return (
    <section
      ref={workspaceRef}
      className={`explorer-workspace${sidebarVisible ? "" : " sidebar-collapsed"}`}
      style={workspaceStyle}
    >
      {sidebarVisible ? (
        <>
          <ExplorerSidebar
            homePath={homePath}
            activePath={activePath}
            mountRoot={mountRoot}
            remotes={sidebarRemotes}
            remoteLoading={providersLoading}
            pinnedPaths={pinnedPaths}
            onNavigate={navigateSidebar}
          />
          <div className="explorer-sidebar-resizer" onPointerDown={startSidebarResize} />
        </>
      ) : null}
      <main ref={mainRef} className="explorer-main-shell">
        <MultiPanelWorkspace
          className="explorer-multipanel"
          renderToolbar={renderToolbar}
          renderContextHeader={renderContextHeader}
          renderAside={inspector}
          onAsideResizeStart={startPreviewResize}
          renderPane={renderPane}
        />
      </main>
      <ExplorerBottomBar
        sidebarVisible={sidebarVisible}
        previewVisible={previewVisible}
        onToggleSidebar={() => useExplorerStore.getState().setSidebarVisible(!sidebarVisible)}
        onTogglePreview={() => useExplorerStore.getState().setPreviewVisible(!previewVisible)}
      />
      {operationError ? <div className="explorer-operation-error">{operationError}</div> : null}
      <ExplorerContextMenu />
      <ExplorerDialog />
    </section>
  );
}

function ExplorerDialog() {
  const dialog = useExplorerStore((state) => state.dialog);
  if (!dialog) return null;
  if (dialog.kind === "batchRename") {
    const invalidCount = dialog.items.filter((item) => item.error).length;
    const firstInvalidIndex = dialog.items.findIndex((item) => item.error);
    const changedCount = dialog.items.filter((item) => `${item.value.trim()}${item.lockedExtension}` !== item.originalName).length;
    return createPortal(
      <div className="explorer-dialog-backdrop" role="presentation" onPointerDown={() => useExplorerStore.getState().closeDialog()}>
        <form
          className="explorer-dialog explorer-dialog-wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="explorer-dialog-title"
          onPointerDown={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            void useExplorerStore.getState().confirmDialog();
          }}
        >
          <header className="batch-rename-header">
            <div>
              <h2 id="explorer-dialog-title">Review Renames</h2>
              <p>{changedCount} of {dialog.items.length} selected items will be renamed.</p>
            </div>
            {invalidCount > 0 ? <span>{invalidCount} need fixes</span> : null}
          </header>
          <div className="batch-rename-list">
            {dialog.items.map((item, index) => (
              <label className="batch-rename-row" key={`${item.paneId}:${item.entryId}`}>
                <span title={item.originalName}>{item.originalName}</span>
                <div>
                  <div className="batch-rename-input">
                    <input
                      value={item.value}
                      autoComplete="off"
                      autoFocus={invalidCount > 0 ? index === firstInvalidIndex : index === 0}
                      aria-invalid={Boolean(item.error)}
                      onChange={(event) => useExplorerStore.getState().setBatchRenameValue(item.paneId, item.entryId, event.target.value)}
                    />
                    {item.lockedExtension ? <small>{item.lockedExtension}</small> : null}
                  </div>
                  {item.error ? <em>{item.error}</em> : null}
                </div>
              </label>
            ))}
          </div>
          <div className="explorer-dialog-actions">
            <button type="button" onClick={() => useExplorerStore.getState().closeDialog()}>Cancel</button>
            <button type="submit" disabled={invalidCount > 0 || changedCount === 0}>Rename</button>
          </div>
        </form>
      </div>,
      document.body,
    );
  }
  const deleteLabel = dialog.paths.length === 1
    ? dialog.paths[0].split("/").filter(Boolean).pop() ?? dialog.paths[0]
    : `${dialog.paths.length} items`;

  return createPortal(
    <div className="explorer-dialog-backdrop" role="presentation" onPointerDown={() => useExplorerStore.getState().closeDialog()}>
      <form
        className="explorer-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="explorer-dialog-title"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void useExplorerStore.getState().confirmDialog();
        }}
      >
        <h2 id="explorer-dialog-title">Delete Permanently</h2>
        <p>Delete <strong>{deleteLabel}</strong>? This cannot be undone.</p>
        <div className="explorer-dialog-actions">
          <button type="button" onClick={() => useExplorerStore.getState().closeDialog()}>Cancel</button>
          <button type="submit" className="danger">Delete</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

const compareActions: Array<{ value: FileSyncPlannedAction; label: string }> = [
  { value: "skip", label: "Skip" },
  { value: "copy_left_to_right", label: "Copy Left -> Right" },
  { value: "copy_right_to_left", label: "Copy Right -> Left" },
  { value: "delete_left", label: "Delete Left" },
  { value: "delete_right", label: "Delete Right" },
];

function FileSyncCompareBar(props: { tab: MultiPanelTab; mountRoot: string }) {
  const leftPane = props.tab.panes[0];
  const rightPane = props.tab.panes[1];
  const left = endpointFromExplorerPath(leftPane?.path ?? props.tab.path, props.mountRoot);
  const right = endpointFromExplorerPath(rightPane?.path ?? props.tab.path, props.mountRoot);
  const session = useFileSyncStore((state) => state.sessions[props.tab.id]);
  const pairs = useFileSyncStore((state) => state.pairs);
  const loadingPairs = useFileSyncStore((state) => state.loadingPairs);
  const pairError = useFileSyncStore((state) => state.pairError);

  useEffect(() => {
    useFileSyncStore.getState().ensureSession(props.tab.id, left, right);
    void useFileSyncStore.getState().loadPairs();
  }, [left.kind, left.localPath, left.providerType, left.remoteName, left.remotePath, props.tab.id,
    right.kind, right.localPath, right.providerType, right.remoteName, right.remotePath]);

  if (!session) return <div className="compare-strip"><span>Preparing compare workspace...</span></div>;
  const counts = compareCounts(session.rows);
  const plannedCount = session.rows.filter((row) => row.action !== "skip").length;

  const navigateToPair = (pairId: number) => {
    const pair = pairs.find((candidate) => candidate.id === pairId);
    if (!pair || !leftPane || !rightPane) return;
    useFileSyncStore.getState().selectPair(props.tab.id, pairId);
    void useExplorerStore.getState().navigatePane(leftPane.id, explorerPathFromEndpoint(pair.left, props.mountRoot));
    void useExplorerStore.getState().navigatePane(rightPane.id, explorerPathFromEndpoint(pair.right, props.mountRoot));
  };

  const swap = () => {
    if (!leftPane || !rightPane) return;
    useFileSyncStore.getState().swapRoots(props.tab.id);
    void useExplorerStore.getState().navigatePane(leftPane.id, explorerPathFromEndpoint(session.right, props.mountRoot));
    void useExplorerStore.getState().navigatePane(rightPane.id, explorerPathFromEndpoint(session.left, props.mountRoot));
  };

  const apply = async () => {
    const result = await useFileSyncStore.getState().apply(props.tab.id);
    if (result && leftPane && rightPane) {
      await Promise.all([
        useExplorerStore.getState().refreshPane(leftPane.id),
        useExplorerStore.getState().refreshPane(rightPane.id),
      ]);
    }
  };

  return (
    <section className="compare-strip">
      <div className="compare-strip-main">
        <div className="compare-title">
          <GitCompareArrows size={17} />
          <strong>Compare</strong>
          <span className={session.comparing ? "working" : session.stale ? "stale" : "ready"}>
            {session.comparing ? "Comparing..." : session.stale ? "Needs review" : "Ready"}
          </span>
        </div>
        <select
          aria-label="Saved sync pair"
          value={session.activePairId ?? ""}
          disabled={loadingPairs}
          onChange={(event) => event.target.value && navigateToPair(Number(event.target.value))}
        >
          <option value="">Saved pairs</option>
          {pairs.map((pair) => <option key={pair.id} value={pair.id}>{pair.name}</option>)}
        </select>
        <input
          aria-label="Sync pair name"
          value={session.pairName}
          placeholder="Saved pair name"
          onChange={(event) => useFileSyncStore.getState().setPairName(props.tab.id, event.target.value)}
        />
        <button type="button" onClick={() => void useFileSyncStore.getState().savePair(props.tab.id)}>Save Pair</button>
        <label className="compare-watch">
          <input
            type="checkbox"
            checked={session.watchMode}
            onChange={(event) => void useFileSyncStore.getState().setWatchMode(props.tab.id, event.target.checked)}
          />
          Watch
        </label>
        <button type="button" onClick={swap}>Swap</button>
        <button type="button" onClick={() => void useFileSyncStore.getState().compare(props.tab.id)} disabled={session.comparing}>
          Compare
        </button>
        <button type="button" className="primary" onClick={() => void apply()} disabled={session.applying || plannedCount === 0}>
          {session.applying ? "Applying..." : `Apply${plannedCount ? ` ${plannedCount}` : ""}`}
        </button>
      </div>
      <div className="compare-summary">
        <span>Left: {leftPane?.path ?? "--"}</span>
        <span>Right: {rightPane?.path ?? "--"}</span>
        <span>Left only: {counts.left_only}</span>
        <span>Right only: {counts.right_only}</span>
        <span>Different: {counts.different}</span>
        <span>Conflict: {counts.conflict}</span>
        {session.error || pairError ? <span className="error-text">{session.error ?? pairError}</span> : null}
        {session.message ? <span className="success-text">{session.message}</span> : null}
      </div>
      {session.rows.length > 0 ? (
        <details className="compare-results">
          <summary>{session.rows.length} comparison results</summary>
          <div className="compare-results-scroll">
            <table>
              <thead><tr><th>Path</th><th>Type</th><th>State</th><th>Action</th></tr></thead>
              <tbody>
                {session.rows.map((row) => (
                  <tr key={row.relativePath}>
                    <td>{row.relativePath}</td><td>{row.kind}</td><td>{row.disposition.replace(/_/g, " ")}</td>
                    <td>
                      <select
                        value={row.action}
                        onChange={(event) => useFileSyncStore.getState().setRowAction(
                          props.tab.id,
                          row.relativePath,
                          event.target.value as FileSyncPlannedAction,
                        )}
                      >
                        {compareActions.map((action) => <option key={action.value} value={action.value}>{action.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}

function ConnectedExplorerToolbar(props: { paneId: string; fallbackPath: string }) {
  const state = useExplorerStore(useShallow((explorer) => {
    const pane = explorer.panes[props.paneId];
    return {
      path: pane?.listing?.path ?? props.fallbackPath,
      commandQuery: pane?.commandQuery ?? "",
      viewMode: explorer.viewMode,
      showHidden: explorer.showHidden,
      canGoBack: Boolean(pane?.backHistory.length),
      canGoForward: Boolean(pane?.forwardHistory.length),
    };
  }));
  const onNavigate = useCallback((path: string) => {
    void useExplorerStore.getState().navigatePane(props.paneId, path);
  }, [props.paneId]);
  const onBack = useCallback(() => {
    void useExplorerStore.getState().navigateBack(props.paneId);
  }, [props.paneId]);
  const onForward = useCallback(() => {
    void useExplorerStore.getState().navigateForward(props.paneId);
  }, [props.paneId]);
  const onParent = useCallback(() => {
    void useExplorerStore.getState().navigateParent(props.paneId);
  }, [props.paneId]);
  const onRefresh = useCallback(() => {
    void useExplorerStore.getState().refreshPane(props.paneId);
  }, [props.paneId]);
  const onCommandQuery = useCallback((query: string) => {
    useExplorerStore.getState().setCommandQuery(props.paneId, query);
  }, [props.paneId]);
  const onToggleHidden = useCallback(() => {
    void useExplorerStore.getState().toggleHidden();
  }, []);
  const onCreateFile = useCallback(() => {
    void useExplorerStore.getState().createItem(props.paneId, "file");
  }, [props.paneId]);
  const onCreateFolder = useCallback(() => {
    void useExplorerStore.getState().createItem(props.paneId, "folder");
  }, [props.paneId]);
  const onCut = useCallback(() => {
    useExplorerStore.getState().cutSelected(props.paneId);
  }, [props.paneId]);
  const onCopy = useCallback(() => {
    useExplorerStore.getState().copySelected(props.paneId);
  }, [props.paneId]);
  const onPaste = useCallback(() => {
    void useExplorerStore.getState().pasteIntoPane(props.paneId);
  }, [props.paneId]);
  const onRename = useCallback(() => {
    void useExplorerStore.getState().renameSelected(props.paneId);
  }, [props.paneId]);
  const onDelete = useCallback(() => {
    void useExplorerStore.getState().deleteSelected(props.paneId);
  }, [props.paneId]);
  const onUploadFiles = useCallback(() => {
    void useExplorerStore.getState().uploadIntoPane(props.paneId, "files");
  }, [props.paneId]);
  const onUploadFolder = useCallback(() => {
    void useExplorerStore.getState().uploadIntoPane(props.paneId, "folders");
  }, [props.paneId]);
  const onCompare = useCallback(() => {
    const path = useExplorerStore.getState().panes[props.paneId]?.listing?.path ?? props.fallbackPath;
    useMultiPanelStore.getState().addCompareTab(path, path);
  }, [props.fallbackPath, props.paneId]);
  const onRunCommand = useCallback((commandId: ExplorerCommandId) => {
    runExplorerCommand(commandId, props.paneId);
  }, [props.paneId]);

  return (
    <ExplorerToolbar
      {...state}
      onNavigate={onNavigate}
      onBack={onBack}
      onForward={onForward}
      onParent={onParent}
      onRefresh={onRefresh}
      onCommandQuery={onCommandQuery}
      onViewMode={useExplorerStore.getState().setViewMode}
      onToggleHidden={onToggleHidden}
      onCreateFile={onCreateFile}
      onCreateFolder={onCreateFolder}
      onCut={onCut}
      onCopy={onCopy}
      onPaste={onPaste}
      onRename={onRename}
      onDelete={onDelete}
      onUploadFiles={onUploadFiles}
      onUploadFolder={onUploadFolder}
      onCompare={onCompare}
      onRunCommand={onRunCommand}
    />
  );
}

function runExplorerCommand(commandId: ExplorerCommandId, paneId: string): void {
  const explorer = useExplorerStore.getState();
  switch (commandId) {
    case "explorer.refresh":
      void explorer.refreshPane(paneId);
      break;
    case "explorer.rename":
      void explorer.renameSelected(paneId);
      break;
    case "explorer.delete":
      void explorer.deleteSelected(paneId);
      break;
    case "explorer.open_with":
      void explorer.openWithSelected(paneId);
      break;
    case "explorer.copy":
      explorer.copySelected(paneId);
      break;
    case "explorer.cut":
      explorer.cutSelected(paneId);
      break;
    case "explorer.paste":
      void explorer.pasteIntoPane(paneId);
      break;
    case "explorer.toggle_hidden":
      void explorer.toggleHidden();
      break;
  }
}

function ConnectedFileInspector() {
  const activePaneId = useMultiPanelStore((state) => state.activePaneId);
  const pane = useExplorerStore((state) => state.panes[activePaneId]);
  return <FileInspector listing={pane?.listing ?? null} selectedEntry={selectedEntryForPane(pane)} />;
}

function ExplorerContextMenu() {
  const {
    contextMenu,
    pane,
    createItem,
    copySelected,
    cutSelected,
    pasteIntoPane,
    renameSelected,
    deleteSelected,
    openWithSelected,
    refreshPane,
    toggleHidden,
    togglePinnedPath,
    copyPath,
    pinnedPaths,
    hasClipboard,
    closeContextMenu,
  } = useExplorerStore(useShallow((state) => ({
    contextMenu: state.contextMenu,
    pane: state.contextMenu.open ? state.panes[state.contextMenu.paneId] : undefined,
    createItem: state.createItem,
    copySelected: state.copySelected,
    cutSelected: state.cutSelected,
    pasteIntoPane: state.pasteIntoPane,
    renameSelected: state.renameSelected,
    deleteSelected: state.deleteSelected,
    openWithSelected: state.openWithSelected,
    refreshPane: state.refreshPane,
    toggleHidden: state.toggleHidden,
    togglePinnedPath: state.togglePinnedPath,
    copyPath: state.copyPath,
    pinnedPaths: state.contextMenu.open ? state.pinnedPaths : emptyPinnedPaths,
    hasClipboard: Boolean(state.clipboard?.items.length),
    closeContextMenu: state.closeContextMenu,
  })));
  const targetEntry = pane?.listing?.entries.find((entry) => entry.id === contextMenu.entryId) ?? null;
  const hasSelection = Boolean(contextMenu.entryId && pane?.selectedIds.length);
  const targetPinned = Boolean(targetEntry && pinnedPaths.some((path) => normalizedPath(path) === normalizedPath(targetEntry.path)));
  const targetCanOpenWith = Boolean(targetEntry && targetEntry.kind !== "folder" && targetEntry.kind !== "symlink");

  useEffect(() => {
    if (!contextMenu.open) return;
    const close = () => useExplorerStore.getState().closeContextMenu();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [contextMenu.open]);

  if (!contextMenu.open) return null;

  const run = (action: () => void) => {
    closeContextMenu();
    action();
  };

  return createPortal(
    <div
      className="explorer-context-menu"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onPointerDown={(event) => event.stopPropagation()}
      role="menu"
    >
      <button type="button" role="menuitem" onClick={() => run(() => void createItem(contextMenu.paneId, "folder"))}>
        <FolderPlus size={17} />
        New Folder
      </button>
      <button type="button" role="menuitem" onClick={() => run(() => void createItem(contextMenu.paneId, "file"))}>
        <FilePlus size={17} />
        New File
      </button>
      <div className="context-menu-separator" />
      <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => run(() => copySelected(contextMenu.paneId))}>
        <Copy size={17} />
        Copy
      </button>
      <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => run(() => cutSelected(contextMenu.paneId))}>
        <Scissors size={17} />
        Cut
      </button>
      <button type="button" role="menuitem" disabled={!hasClipboard} onClick={() => run(() => void pasteIntoPane(contextMenu.paneId))}>
        <Clipboard size={17} />
        Paste
      </button>
      <div className="context-menu-separator" />
      <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => run(() => void renameSelected(contextMenu.paneId))}>
        <Pencil size={17} />
        Rename
      </button>
      <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => run(() => void deleteSelected(contextMenu.paneId))}>
        <Trash2 size={17} />
        Delete
      </button>
      {contextMenu.entryId ? (
        <>
          <div className="context-menu-separator" />
          <button
            type="button"
            role="menuitem"
            disabled={!targetCanOpenWith}
            onClick={() => run(() => void openWithSelected(contextMenu.paneId))}
          >
            <AppWindow size={17} />
            Open With...
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!targetEntry || targetEntry.kind !== "folder"}
            onClick={() => run(() => targetEntry && togglePinnedPath(targetEntry.path))}
          >
            <Pin size={17} />
            {targetPinned ? "Unpin from Quick access" : "Pin to Quick access"}
          </button>
          <div className="context-menu-separator" />
          <button
            type="button"
            role="menuitem"
            disabled={!targetEntry}
            onClick={() => run(() => targetEntry && void copyPath(targetEntry.path))}
          >
            <Copy size={17} />
            Copy Path
          </button>
        </>
      ) : (
        <>
          <div className="context-menu-separator" />
          <button type="button" role="menuitem" onClick={() => run(() => void toggleHidden())}>
            <Eye size={17} />
            {useExplorerStore.getState().showHidden ? "Hide Hidden Files" : "Show Hidden Files"}
          </button>
        </>
      )}
      <div className="context-menu-separator" />
      <button type="button" role="menuitem" onClick={() => run(() => void refreshPane(contextMenu.paneId))}>
        <RefreshCcw size={17} />
        Refresh
      </button>
    </div>,
    document.body,
  );
}

function ExplorerBottomBar(props: {
  sidebarVisible: boolean;
  previewVisible: boolean;
  onToggleSidebar: () => void;
  onTogglePreview: () => void;
}) {
  return (
    <footer className="explorer-bottom-bar">
      <button
        type="button"
        className={props.sidebarVisible ? "selected" : ""}
        title={props.sidebarVisible ? "Hide sidebar" : "Show sidebar"}
        onClick={props.onToggleSidebar}
      >
        <PanelLeft size={15} />
      </button>
      <button
        type="button"
        className={props.previewVisible ? "selected" : ""}
        title={props.previewVisible ? "Hide preview" : "Show preview"}
        onClick={props.onTogglePreview}
      >
        <PanelRight size={15} />
      </button>
    </footer>
  );
}

function endpointFromExplorerPath(path: string, mountRoot: string): FileSyncEndpoint {
  const cleanPath = normalizedPath(path);
  const cleanMount = normalizedPath(mountRoot);
  if (cleanPath === cleanMount || cleanPath.startsWith(`${cleanMount}/`)) {
    const parts = cleanPath.slice(cleanMount.length).split("/").filter(Boolean);
    if (parts.length >= 2) {
      return {
        kind: "remote",
        providerType: parts[0],
        remoteName: parts[1],
        remotePath: parts.length > 2 ? `/${parts.slice(2).join("/")}` : "/",
        localPath: "",
      };
    }
  }
  return { kind: "local", localPath: path, remoteName: "", remotePath: "", providerType: "" };
}

function explorerPathFromEndpoint(endpoint: FileSyncEndpoint, mountRoot: string): string {
  if (endpoint.kind === "local") return endpoint.localPath;
  const suffix = endpoint.remotePath.replace(/^\/+/, "");
  return [normalizedPath(mountRoot), endpoint.providerType, endpoint.remoteName, suffix]
    .filter(Boolean)
    .join("/");
}

function compareCounts(rows: Array<{ disposition: string }>): Record<string, number> {
  const counts: Record<string, number> = {
    left_only: 0,
    right_only: 0,
    different: 0,
    same: 0,
    conflict: 0,
  };
  for (const row of rows) counts[row.disposition] = (counts[row.disposition] ?? 0) + 1;
  return counts;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveMountRoot(homePath: string, configuredPath: string): string {
  if (configuredPath.startsWith("/")) return configuredPath.replace(/\/+$/, "");
  return `${homePath.replace(/\/+$/, "")}/${configuredPath.replace(/^\/+|\/+$/g, "")}`;
}

function normalizedPath(path: string): string {
  return path.replace(/\/+$/, "");
}

function multiPanelWorkspaceNeedsSave(
  state: ReturnType<typeof useMultiPanelStore.getState>,
  previous: ReturnType<typeof useMultiPanelStore.getState>,
): boolean {
  return state.tabs !== previous.tabs
    || state.activeTabId !== previous.activeTabId
    || state.activePaneId !== previous.activePaneId
    || state.closedPanes !== previous.closedPanes
    || state.nextPaneIndex !== previous.nextPaneIndex
    || state.nextTabIndex !== previous.nextTabIndex;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function externalDropTargetAt(
  position: { x: number; y: number },
  fallbackPaneId: string,
  fallbackDestination: string,
): ExternalDropTarget | null {
  const scale = window.devicePixelRatio || 1;
  const element = document.elementFromPoint(position.x / scale, position.y / scale);
  const paneElement = element?.closest<HTMLElement>("[data-explorer-pane-id]");
  const destinationElement = element?.closest<HTMLElement>("[data-drop-destination]");
  const paneId = paneElement?.dataset.explorerPaneId ?? fallbackPaneId;
  const destination = destinationElement?.dataset.dropDestination ?? fallbackDestination;
  const kind = destinationElement?.dataset.dropKind === "folder" || destinationElement?.dataset.dropKind === "directory"
    ? destinationElement.dataset.dropKind
    : "unknown";
  if (!paneId || !destination) return null;
  return { paneId, destination, kind };
}
