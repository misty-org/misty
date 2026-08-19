import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { useShallow } from "zustand/react/shallow";
import {
  createCodeTabState,
  dockLeaves,
  parseCodeTabState,
  useWorkspaceStore,
  type CodeTabState,
  type WorkspaceTab,
} from "@/features/workspace";
import { killTerminalTab } from "@/features/terminal";
import {
  selectEditorPreferences,
  selectShortcutPreferences,
  useSettingsStore,
} from "@/features/settings";
import { shortcutMapFromBindings } from "@/shared/lib/shortcuts";
import { CodeCommandCenter, type CommandCenterMode } from "./components/CodeCommandCenter";
import { CodeEditor } from "./components/CodeEditor";
import { CodeExplorer } from "./components/CodeExplorer";
import { CodeStatusBar } from "./components/CodeStatusBar";
import { OpenFolderCard } from "./components/OpenFolderCard";
import { useGitStore } from "./git/useGitStore";
import { GitHubCodeSheet } from "./github/GitHubCodeSheet";
import { openFileInWorkspace } from "./openFile";
import { projectState, useCodingWorkspaceStore } from "./store/useCodingWorkspaceStore";
import { useFileWatcher } from "./watcher/useFileWatcher";
import {
  basename,
  codeCommandForEvent,
  defaultCodeShortcuts,
  displayFileTitle,
  EmptyEditor,
  isOwnedTerminal,
  languageOf,
  useCodeCommands,
} from "./codeWorkspaceSupport";

const InlineRewrite = lazy(() =>
  import("./ai/InlineRewrite").then((module) => ({ default: module.InlineRewrite })),
);

interface InlineRequest {
  path: string;
  viewId: string;
  selection: string;
  from: number;
  to: number;
}

export function CodingWorkspace({ tab }: { tab?: WorkspaceTab }) {
  const fallbackTab = useWorkspaceStore((state) =>
    dockLeaves(state.layout.root)
      .flatMap((pane) => pane.tabs)
      .find((entry) => entry.surfaceId === "code"),
  );
  const codeTab = tab ?? fallbackTab;
  const codeState = parseCodeTabState(codeTab?.state);
  const rootPath = codeState.rootPath;
  const codeTitleKey = useWorkspaceStore((state) =>
    dockLeaves(state.layout.root)
      .flatMap((pane) => pane.tabs)
      .filter((entry) => entry.surfaceId === "code")
      .map((entry) => `${entry.id}:${parseCodeTabState(entry.state).activeFilePath ?? ""}`)
      .sort()
      .join("\0"),
  );
  const filesOpen = codeTab?.sidebarVisible ?? true;
  const legacyRoot = useCodingWorkspaceStore((state) => state.rootPath);
  const legacyExpandedFolders = useCodingWorkspaceStore((state) => state.expandedFolders);
  const ensureView = useCodingWorkspaceStore((state) => state.ensureView);
  const clearView = useCodingWorkspaceStore((state) => state.clearView);
  const activeBuffer = useCodingWorkspaceStore(
    useShallow((state) => {
      if (!codeTab || !rootPath) return null;
      const path = state.views[codeTab.id]?.activeFilePath;
      return path ? (state.projectBuffers[rootPath]?.[path] ?? null) : null;
    }),
  );
  const project = useCodingWorkspaceStore((state) =>
    rootPath ? projectState(state.projects[rootPath]) : null,
  );
  const editorAppearance = useSettingsStore(
    useShallow((state) => {
      const preferences = selectEditorPreferences(state.settings?.document);
      return { theme: preferences.theme, interfaceScale: preferences.interfaceScale };
    }),
  );
  const shortcutSnapshot = useSettingsStore((state) => state.shortcuts);
  const customShortcutsEnabled = useSettingsStore(
    (state) => selectShortcutPreferences(state.settings?.document).customShortcutsEnabled,
  );
  const shortcuts = useMemo(() => {
    const fallback = defaultCodeShortcuts();
    return customShortcutsEnabled && shortcutSnapshot
      ? shortcutMapFromBindings(shortcutSnapshot.bindings, fallback)
      : fallback;
  }, [customShortcutsEnabled, shortcutSnapshot]);
  const [commandMode, setCommandMode] = useState<CommandCenterMode | null>(() =>
    rootPath && !codeState.activeFilePath ? "files" : null,
  );
  const [githubOpen, setGithubOpen] = useState(false);
  const [inlineRequest, setInlineRequest] = useState<InlineRequest | null>(null);
  const filesRef = useRef<ImperativePanelHandle | null>(null);
  const resizeTimerRef = useRef<number | null>(null);

  const patchCodeState = useCallback(
    (patch: Partial<CodeTabState>, title?: string) => {
      if (!codeTab) return;
      const workspace = useWorkspaceStore.getState();
      const current = dockLeaves(workspace.layout.root)
        .flatMap((pane) => pane.tabs)
        .find((entry) => entry.id === codeTab.id);
      workspace.updateTabState(
        codeTab.id,
        { ...parseCodeTabState(current?.state), ...patch, version: 1 },
        title,
      );
    },
    [codeTab],
  );

  useEffect(() => {
    if (!codeTab) return;
    ensureView(codeTab.id, rootPath);
  }, [codeTab, ensureView, rootPath]);

  useEffect(() => {
    if (!codeTab || rootPath || !legacyRoot) return;
    const store = useCodingWorkspaceStore.getState();
    if (!store.projects[legacyRoot] && legacyExpandedFolders.length) {
      useCodingWorkspaceStore.setState({
        projects: {
          ...store.projects,
          [legacyRoot]: { expandedFolders: legacyExpandedFolders, marks: [], recents: [] },
        },
      });
    }
    patchCodeState({ rootPath: legacyRoot, activeFilePath: null });
  }, [codeTab, legacyExpandedFolders, legacyRoot, patchCodeState, rootPath]);

  useEffect(() => {
    if (!codeTab || !rootPath || !codeState.activeFilePath) return;
    const view = useCodingWorkspaceStore.getState().views[codeTab.id];
    if (view?.rootPath === rootPath && view.activeFilePath === codeState.activeFilePath) return;
    openFileInWorkspace(
      codeState.activeFilePath,
      basename(codeState.activeFilePath),
      undefined,
      codeTab.id,
      rootPath,
    );
  }, [codeState.activeFilePath, codeTab, rootPath]);

  useEffect(() => {
    if (!codeTab || !rootPath || !codeState.activeFilePath) return;
    const title = displayFileTitle(codeState.activeFilePath, rootPath, codeTab.id);
    if (codeTab.title !== title) useWorkspaceStore.getState().renameTab(codeTab.id, title);
  }, [codeState.activeFilePath, codeTab, codeTitleKey, rootPath]);

  useFileWatcher(rootPath);

  const refreshGit = useGitStore((state) => state.refresh);
  useEffect(() => {
    if (!rootPath) return;
    const startup = window.setTimeout(() => void refreshGit(rootPath), 500);
    const interval = window.setInterval(() => void refreshGit(rootPath), 30_000);
    return () => {
      window.clearTimeout(startup);
      window.clearInterval(interval);
    };
  }, [refreshGit, rootPath]);

  useEffect(() => {
    document.documentElement.dataset.codeOverlayTheme = editorAppearance.theme;
    document.documentElement.dataset.codeOverlayScale = String(editorAppearance.interfaceScale);
    return () => {
      delete document.documentElement.dataset.codeOverlayTheme;
      delete document.documentElement.dataset.codeOverlayScale;
    };
  }, [editorAppearance.interfaceScale, editorAppearance.theme]);

  useEffect(() => {
    const panel = filesRef.current;
    if (!panel) return;
    if (filesOpen && panel.isCollapsed()) panel.expand();
    if (!filesOpen && !panel.isCollapsed()) panel.collapse();
  }, [filesOpen]);

  const setRoot = useCallback(
    (path: string) => {
      if (!codeTab) return;
      clearView(codeTab.id);
      patchCodeState({ rootPath: path, activeFilePath: null }, `Code · ${basename(path)}`);
      setCommandMode("files");
    },
    [clearView, codeTab, patchCodeState],
  );

  const focusExistingFileView = useCallback(
    (path: string) => {
      const workspace = useWorkspaceStore.getState();
      const existing = dockLeaves(workspace.layout.root)
        .flatMap((pane) => pane.tabs)
        .find((entry) => {
          if (entry.id === codeTab?.id || entry.surfaceId !== "code") return false;
          const state = parseCodeTabState(entry.state);
          return state.rootPath === rootPath && state.activeFilePath === path;
        });
      if (!existing) return false;
      workspace.focusTab(existing.id);
      return true;
    },
    [codeTab?.id, rootPath],
  );

  const openFile = useCallback(
    (path: string, name: string, line?: number) => {
      if (!codeTab || !rootPath) return;
      if (focusExistingFileView(path)) return;
      openFileInWorkspace(path, name, line, codeTab.id, rootPath);
      patchCodeState({ activeFilePath: path }, displayFileTitle(path, rootPath, codeTab.id));
    },
    [codeTab, focusExistingFileView, patchCodeState, rootPath],
  );

  const openFileInNewTab = useCallback(
    (path: string, name: string, line?: number) => {
      if (!codeTab || !rootPath || focusExistingFileView(path)) return;
      const workspace = useWorkspaceStore.getState();
      const pane = dockLeaves(workspace.layout.root).find((entry) =>
        entry.tabs.some((candidate) => candidate.id === codeTab.id),
      );
      const created = workspace.openSurface({
        surfaceId: "code",
        groupKey: "tool:code",
        title: displayFileTitle(path, rootPath),
        route: codeTab.route,
        instancePolicy: "multiple",
        forceNew: true,
        paneId: pane?.id,
        state: createCodeTabState({
          rootPath,
          activeFilePath: path,
          explorerWidth: codeState.explorerWidth,
        }),
        sidebarVisible: filesOpen,
      });
      workspace.focusTab(created.id);
      if (line)
        window.setTimeout(
          () =>
            window.dispatchEvent(
              new CustomEvent("misty:code-goto-line", { detail: { path, line } }),
            ),
          50,
        );
    },
    [codeState.explorerWidth, codeTab, filesOpen, focusExistingFileView, rootPath],
  );

  const previousFile = useCallback(() => {
    if (!project || !activeBuffer) return;
    const currentIndex = project.recents.indexOf(activeBuffer.path);
    const target = project.recents[currentIndex < 0 ? 0 : currentIndex + 1] ?? project.recents[0];
    if (target && target !== activeBuffer.path) openFile(target, basename(target));
  }, [activeBuffer, openFile, project]);

  const terminalOpen = useWorkspaceStore((state) =>
    codeTab
      ? dockLeaves(state.layout.root)
          .flatMap((pane) => pane.tabs)
          .some((entry) => isOwnedTerminal(entry, codeTab.id))
      : false,
  );
  const toggleTerminal = useCallback(() => {
    if (!codeTab) return;
    const workspace = useWorkspaceStore.getState();
    const leaves = dockLeaves(workspace.layout.root);
    const existing = leaves
      .flatMap((pane) => pane.tabs)
      .find((entry) => isOwnedTerminal(entry, codeTab.id));
    if (existing) {
      killTerminalTab(existing.id);
      workspace.closeTab(existing.id);
      workspace.focusTab(codeTab.id);
      return;
    }
    const codePane = leaves.find((pane) => pane.tabs.some((entry) => entry.id === codeTab.id));
    if (!codePane) return;
    const terminal = workspace.openSurface({
      surfaceId: "terminal",
      groupKey: "tool:terminal",
      title: "Terminal",
      route: codeTab.route,
      instancePolicy: "multiple",
      forceNew: true,
      paneId: codePane.id,
      state: { version: 1, owner: "code", codeTabId: codeTab.id },
    });
    workspace.dockTab(terminal.id, codePane.id, "down");
    workspace.focusTab(terminal.id);
  }, [codeTab]);

  const { commands, openExtensions, openModelsSettings } = useCodeCommands(
    codeTab,
    setCommandMode,
    toggleTerminal,
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!codeTab) return;
      const workspace = useWorkspaceStore.getState();
      const focused = dockLeaves(workspace.layout.root).find(
        (pane) => pane.id === workspace.layout.focusedPaneId,
      );
      if (focused?.activeTabId !== codeTab.id) return;
      const commandId = codeCommandForEvent(event, shortcuts);
      if (!commandId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (commandId === "code.quick_open") setCommandMode("files");
      else if (commandId === "code.command_palette") setCommandMode("commands");
      else if (commandId === "code.search_project") setCommandMode("search");
      else if (commandId === "code.harpoon") setCommandMode("harpoon");
      else if (commandId === "code.previous_file") previousFile();
      else if (commandId === "code.toggle_explorer") workspace.toggleSidebar(codeTab.id);
      else if (commandId === "code.toggle_terminal") toggleTerminal();
      else if (commandId.startsWith("code.mark_") && rootPath && project) {
        const target = project.marks[Number(commandId.slice(-1)) - 1];
        if (target) openFile(target, basename(target));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [codeTab, openFile, previousFile, project, rootPath, shortcuts, toggleTerminal]);

  useEffect(() => {
    const handleInline = (event: Event) => {
      const detail = (event as CustomEvent<InlineRequest>).detail;
      if (detail?.viewId === codeTab?.id) setInlineRequest(detail);
    };
    window.addEventListener("misty:code-inline-ai", handleInline);
    return () => window.removeEventListener("misty:code-inline-ai", handleInline);
  }, [codeTab?.id]);

  useEffect(() => {
    const handleOpenFile = (event: Event) => {
      const detail = (
        event as CustomEvent<{ path?: string; name?: string; line?: number; viewId?: string }>
      ).detail;
      if (detail?.viewId !== codeTab?.id || !detail.path) return;
      openFile(detail.path, detail.name ?? basename(detail.path), detail.line);
    };
    window.addEventListener("misty:code-open-file", handleOpenFile);
    return () => window.removeEventListener("misty:code-open-file", handleOpenFile);
  }, [codeTab?.id, openFile]);

  const applyInlineRewrite = useCallback(
    (text: string) => {
      if (!inlineRequest || !rootPath) return;
      const { path, viewId, from, to } = inlineRequest;
      window.dispatchEvent(
        new CustomEvent("misty:code-inline-apply", { detail: { path, viewId, from, to, text } }),
      );
      const store = useCodingWorkspaceStore.getState();
      const buffer = store.projectBuffers[rootPath]?.[path];
      if (buffer)
        store.updateBufferContents(
          rootPath,
          path,
          buffer.contents.slice(0, from) + text + buffer.contents.slice(to),
        );
    },
    [inlineRequest, rootPath],
  );

  if (!codeTab) return null;
  if (!rootPath)
    return (
      <section
        data-editor-theme={editorAppearance.theme}
        data-interface-scale={editorAppearance.interfaceScale}
        className="coding-workspace code-empty-workspace h-full min-h-0"
      >
        <OpenFolderCard onOpenRoot={setRoot} onOpenGitHub={() => setGithubOpen(true)} />
        <GitHubCodeSheet
          open={githubOpen}
          onOpenChange={setGithubOpen}
          rootPath={null}
          onOpenRoot={setRoot}
        />
      </section>
    );

  return (
    <section
      data-editor-theme={editorAppearance.theme}
      data-interface-scale={editorAppearance.interfaceScale}
      className="coding-workspace relative grid h-full min-h-0 bg-charcoal-workspace"
    >
      <CodeCommandCenter
        viewId={codeTab.id}
        rootPath={rootPath}
        activePath={activeBuffer?.path ?? null}
        mode={commandMode}
        onModeChange={setCommandMode}
        onOpenFile={openFile}
        onOpenFileInNewTab={openFileInNewTab}
        onPreviousFile={previousFile}
        commands={commands}
      />
      <PanelGroup direction="horizontal" className="min-h-0">
        <Panel
          ref={filesRef}
          defaultSize={codeState.explorerWidth}
          minSize={14}
          maxSize={42}
          collapsible
          collapsedSize={0}
          onCollapse={() => filesOpen && useWorkspaceStore.getState().toggleSidebar(codeTab.id)}
          onExpand={() => !filesOpen && useWorkspaceStore.getState().toggleSidebar(codeTab.id)}
          onResize={(size) => {
            if (size < 14) return;
            if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
            resizeTimerRef.current = window.setTimeout(
              () => patchCodeState({ explorerWidth: size }),
              160,
            );
          }}
        >
          <CodeExplorer
            rootPath={rootPath}
            viewId={codeTab.id}
            onOpenFile={openFile}
            onOpenFileInNewTab={openFileInNewTab}
            onOpenRoot={setRoot}
          />
        </Panel>
        <PanelResizeHandle className="w-px bg-charcoal-border transition-colors hover:bg-charcoal-active" />
        <Panel minSize={30}>
          <div className="code-theme-editor h-full min-h-0 bg-charcoal-bg text-cream">
            {activeBuffer ? (
              <CodeEditor tab={activeBuffer} groupId={codeTab.id} rootPath={rootPath} />
            ) : (
              <EmptyEditor rootPath={rootPath} onOpen={() => setCommandMode("files")} />
            )}
          </div>
        </Panel>
      </PanelGroup>
      <CodeStatusBar
        viewId={codeTab.id}
        rootPath={rootPath}
        activeTab={activeBuffer}
        filesOpen={filesOpen}
        terminalOpen={terminalOpen}
        onToggleFiles={() => useWorkspaceStore.getState().toggleSidebar(codeTab.id)}
        onOpenHarpoon={() => setCommandMode("harpoon")}
        onOpenSearch={() => setCommandMode("search")}
        onToggleTerminal={toggleTerminal}
        onOpenFile={openFile}
        onOpenGitHub={() => setGithubOpen(true)}
        onOpenAi={openModelsSettings}
        onOpenExtensions={openExtensions}
      />
      <GitHubCodeSheet
        open={githubOpen}
        onOpenChange={setGithubOpen}
        rootPath={rootPath}
        onOpenRoot={setRoot}
      />
      {inlineRequest ? (
        <Suspense fallback={null}>
          <InlineRewrite
            open
            selection={inlineRequest.selection}
            language={languageOf(activeBuffer?.name)}
            filename={activeBuffer?.name ?? ""}
            onClose={() => setInlineRequest(null)}
            onApply={applyInlineRewrite}
            onOpenSettings={() => {
              openModelsSettings();
              setInlineRequest(null);
            }}
          />
        </Suspense>
      ) : null}
    </section>
  );
}
