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
  codeTabActiveFilePath,
  dockLeaves,
  parseCodeTabState,
  useWorkspaceStore,
  type CodeTabState,
  type CodeMultibufferSpec,
  type DockSplitDirection,
  type WorkspaceTab,
} from "@/features/workspace";
import { killTerminalTab } from "@/features/terminal";
import { registerShortcutHandler, useShortcutTitle } from "@/features/shortcuts";
import { selectEditorPreferences, useSettingsStore } from "@/features/settings";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/shared/ui";
import {
  CodeCommandCenter,
  type CodeCommand,
  type CommandCenterMode,
} from "./components/CodeCommandCenter";
import {
  CodeEditor,
  codeActionsForEditor,
  documentSymbolsForEditor,
  editorLocation,
  editorWord,
  executeCodeActionCommand,
  renameForEditor,
  requestInlineAi,
  runEditorSelectionAction,
} from "./components/CodeEditor";
import { CodeExplorer } from "./components/CodeExplorer";
import { CodeMultibuffer } from "./components/CodeMultibuffer";
import { CodeStatusBar } from "./components/CodeStatusBar";
import { codeTopActions } from "./components/codeTopActions";
import { OpenFolderCard } from "./components/OpenFolderCard";
import { openFileInWorkspace } from "./openFile";
import { projectState, useCodingWorkspaceStore } from "./store/useCodingWorkspaceStore";
import { useEditorEphemeralStore } from "./store/useEditorEphemeralStore";
import { useFileWatcher } from "./watcher/useFileWatcher";
import { prepareWorkspaceEdit } from "./lsp/workspaceEdits";
import type { DocumentSymbol, LspCodeAction } from "./lsp/codeMirrorLsp";
import { AiSurfaceButton } from "@/features/ai-surface/AiPaneHost";
import { useCodeAiAdapter } from "./ai/useCodeAiAdapter";
import {
  basename,
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
  ranges: Array<{ from: number; to: number }>;
}
export function CodingWorkspace({ tab }: { tab?: WorkspaceTab }) {
  const documentSymbolsTitle = useShortcutTitle("Document symbols", "code.document_symbols");
  const codeActionsTitle = useShortcutTitle("Code actions", "code.code_actions");
  const inlineAiTitle = useShortcutTitle("Inline AI", "code.inline_ai");
  const fallbackTab = useWorkspaceStore((state) =>
    dockLeaves(state.layout.root)
      .flatMap((pane) => pane.tabs)
      .find((entry) => entry.surfaceId === "code"),
  );
  const codeTab = tab ?? fallbackTab;
  const codeState = parseCodeTabState(codeTab?.state);
  const rootPath = codeState.rootPath;
  const activeFilePath = codeTabActiveFilePath(codeState);
  const multibufferSpec =
    codeState.viewport.kind === "multibuffer" ? codeState.viewport.spec : null;
  const codeTitleKey = useWorkspaceStore((state) =>
    dockLeaves(state.layout.root)
      .flatMap((pane) => pane.tabs)
      .filter((entry) => entry.surfaceId === "code")
      .map((entry) => `${entry.id}:${codeTabActiveFilePath(parseCodeTabState(entry.state)) ?? ""}`)
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
      if (!codeTab || !rootPath || codeState.viewport.kind !== "file") return null;
      const path = state.views[codeTab.id]?.activeFilePath;
      return path ? (state.projectBuffers[rootPath]?.[path] ?? null) : null;
    }),
  );
  const navigation = useCodingWorkspaceStore(
    useShallow((state) => {
      const view = codeTab ? state.views[codeTab.id] : null;
      return {
        canGoBack: Boolean(view && (view.historyIndex ?? -1) > 0),
        canGoForward: Boolean(
          view &&
          (view.historyIndex ?? -1) >= 0 &&
          (view.historyIndex ?? -1) < (view.history?.length ?? 0) - 1,
        ),
      };
    }),
  );
  const project = useCodingWorkspaceStore((state) =>
    rootPath ? projectState(state.projects[rootPath]) : null,
  );
  const symbolContext = useEditorEphemeralStore((state) =>
    codeTab ? (state.symbolContexts[codeTab.id] ?? null) : null,
  );
  const editorAppearance = useSettingsStore(
    useShallow((state) => {
      const preferences = selectEditorPreferences(state.settings?.document);
      return { theme: preferences.theme, interfaceScale: preferences.interfaceScale };
    }),
  );
  const [commandMode, setCommandMode] = useState<CommandCenterMode | null>(() =>
    rootPath && codeState.viewport.kind === "file" && !activeFilePath ? "files" : null,
  );
  const [inlineRequest, setInlineRequest] = useState<InlineRequest | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [outlineCommands, setOutlineCommands] = useState<CodeCommand[]>([]);
  const [codeActionCommands, setCodeActionCommands] = useState<CodeCommand[]>([]);
  const [topActionMenu, setTopActionMenu] = useState<"outline" | "actions" | null>(null);
  const filesRef = useRef<ImperativePanelHandle | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  useCodeAiAdapter({ buffer: activeBuffer, bufferId: codeTab?.id, rootPath });

  const patchCodeState = useCallback(
    (patch: Partial<Omit<CodeTabState, "version">>, title?: string) => {
      if (!codeTab) return;
      const workspace = useWorkspaceStore.getState();
      const current = dockLeaves(workspace.layout.root)
        .flatMap((pane) => pane.tabs)
        .find((entry) => entry.id === codeTab.id);
      workspace.updateTabState(
        codeTab.id,
        createCodeTabState({
          ...parseCodeTabState(current?.state),
          ...patch,
        }),
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
    patchCodeState({ rootPath: legacyRoot, viewport: { kind: "file", activeFilePath: null } });
  }, [codeTab, legacyExpandedFolders, legacyRoot, patchCodeState, rootPath]);

  useEffect(() => {
    if (!codeTab || !rootPath || !activeFilePath) return;
    const view = useCodingWorkspaceStore.getState().views[codeTab.id];
    if (view?.rootPath === rootPath && view.activeFilePath === activeFilePath) return;
    openFileInWorkspace(activeFilePath, basename(activeFilePath), undefined, codeTab.id, rootPath);
  }, [activeFilePath, codeTab, rootPath]);

  useEffect(() => {
    if (!codeTab || !rootPath || !activeFilePath) return;
    const title = displayFileTitle(activeFilePath, rootPath, codeTab.id);
    if (codeTab.title !== title) useWorkspaceStore.getState().renameTab(codeTab.id, title);
  }, [activeFilePath, codeTab, codeTitleKey, rootPath]);

  useFileWatcher(rootPath);

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
      patchCodeState(
        { rootPath: path, viewport: { kind: "file", activeFilePath: null } },
        `Code · ${basename(path)}`,
      );
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
          return state.rootPath === rootPath && codeTabActiveFilePath(state) === path;
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
      patchCodeState(
        { viewport: { kind: "file", activeFilePath: path } },
        displayFileTitle(path, rootPath, codeTab.id),
      );
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
          viewport: { kind: "file", activeFilePath: path },
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

  const openMultibuffer = useCallback(
    (spec: CodeMultibufferSpec) => {
      if (!codeTab || !rootPath) return;
      const workspace = useWorkspaceStore.getState();
      const existing = dockLeaves(workspace.layout.root)
        .flatMap((pane) => pane.tabs)
        .find((entry) => {
          if (entry.surfaceId !== "code") return false;
          const state = parseCodeTabState(entry.state);
          return (
            state.rootPath === rootPath &&
            state.viewport.kind === "multibuffer" &&
            state.viewport.spec.id === spec.id
          );
        });
      if (existing) {
        workspace.focusTab(existing.id);
        return;
      }
      const pane = dockLeaves(workspace.layout.root).find((entry) =>
        entry.tabs.some((candidate) => candidate.id === codeTab.id),
      );
      const created = workspace.openSurface({
        surfaceId: "code",
        groupKey: "tool:code",
        title: spec.title,
        route: codeTab.route,
        instancePolicy: "multiple",
        forceNew: true,
        paneId: pane?.id,
        state: createCodeTabState({
          rootPath,
          viewport: { kind: "multibuffer", spec },
          explorerWidth: codeState.explorerWidth,
        }),
        sidebarVisible: filesOpen,
      });
      workspace.focusTab(created.id);
    },
    [codeState.explorerWidth, codeTab, filesOpen, rootPath],
  );

  const openSearchResults = useCallback(
    (query: string) => {
      const trimmed = query.replace(/^\//, "").trim();
      if (!trimmed) return;
      openMultibuffer({
        id: `search:${Date.now()}:${trimmed}`,
        kind: "search",
        title: `Search: ${trimmed}`,
        query: trimmed,
        caseSensitive: false,
      });
    },
    [openMultibuffer],
  );

  const openDiagnostics = useCallback(() => {
    openMultibuffer({
      id: `diagnostics:${rootPath ?? "project"}`,
      kind: "diagnostics",
      title: "Problems",
    });
  }, [openMultibuffer, rootPath]);

  const previousFile = useCallback(() => {
    if (!project || !activeBuffer) return;
    const currentIndex = project.recents.indexOf(activeBuffer.path);
    const target = project.recents[currentIndex < 0 ? 0 : currentIndex + 1] ?? project.recents[0];
    if (target && target !== activeBuffer.path) openFile(target, basename(target));
  }, [activeBuffer, openFile, project]);

  const navigateHistory = useCallback(
    (direction: -1 | 1) => {
      if (!codeTab || !rootPath) return;
      const target = useCodingWorkspaceStore.getState().navigateViewHistory(codeTab.id, direction);
      if (target)
        patchCodeState(
          { viewport: { kind: "file", activeFilePath: target } },
          displayFileTitle(target, rootPath, codeTab.id),
        );
    },
    [codeTab, patchCodeState, rootPath],
  );

  const terminalOpen = useWorkspaceStore((state) =>
    codeTab
      ? dockLeaves(state.layout.root)
          .flatMap((pane) => pane.tabs)
          .some((entry) => isOwnedTerminal(entry, codeTab.id))
      : false,
  );
  const toggleTerminal = useCallback(
    (direction: DockSplitDirection | "current" = "down") => {
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
      if (direction !== "current") workspace.dockTab(terminal.id, codePane.id, direction);
      workspace.focusTab(terminal.id);
    },
    [codeTab],
  );

  const { commands, openExtensions, openModelsSettings } = useCodeCommands(
    codeTab,
    setCommandMode,
    toggleTerminal,
  );

  const openReferences = useCallback(() => {
    const origin = codeTab ? editorLocation(codeTab.id) : null;
    if (!origin) return;
    openMultibuffer({
      id: `references:${Date.now()}:${origin.path}:${origin.line}:${origin.character}`,
      kind: "references",
      title: `References: ${editorWord(codeTab!.id) || basename(origin.path)}`,
      origin,
    });
  }, [codeTab, openMultibuffer]);

  const openOutline = useCallback(() => {
    if (!codeTab) return;
    setTopActionMenu("outline");
    void documentSymbolsForEditor(codeTab.id).then((symbols) => {
      const flattened = flattenDocumentSymbols(symbols);
      setOutlineCommands(
        flattened.map(({ symbol, depth }) => ({
          id: `symbol:${symbol.name}:${symbol.selectionRange?.start.line ?? symbol.range.start.line}`,
          label: `${"  ".repeat(depth)}${symbol.name}`,
          run: () => {
            const path = editorLocation(codeTab.id)?.path;
            if (path)
              window.dispatchEvent(
                new CustomEvent("misty:code-goto-line", {
                  detail: {
                    path,
                    line: (symbol.selectionRange?.start.line ?? symbol.range.start.line) + 1,
                  },
                }),
              );
          },
        })),
      );
    });
  }, [codeTab]);

  const runCodeAction = useCallback(
    (action: LspCodeAction) => {
      if (!codeTab || !rootPath) return;
      const origin = editorLocation(codeTab.id);
      if (action.edit && origin) {
        const id = `code-action:${Date.now()}`;
        void prepareWorkspaceEdit(id, rootPath, action.title, action.edit).then(() =>
          openMultibuffer({
            id,
            kind: "code-action",
            title: action.title,
            origin,
            expired: true,
          }),
        );
      } else {
        void executeCodeActionCommand(codeTab.id, action);
      }
    },
    [codeTab, openMultibuffer, rootPath],
  );

  const openCodeActions = useCallback(() => {
    if (!codeTab) return;
    setTopActionMenu("actions");
    void codeActionsForEditor(codeTab.id).then((actions) => {
      setCodeActionCommands(
        actions.map((action, index) => ({
          id: `code-action:${index}:${action.title}`,
          label: action.title,
          run: () => runCodeAction(action),
        })),
      );
    });
  }, [codeTab, runCodeAction]);

  const startRename = useCallback(() => {
    if (!codeTab) return;
    setRenameDraft(editorWord(codeTab.id));
    setRenameOpen(true);
  }, [codeTab]);

  const submitRename = useCallback(async () => {
    if (!codeTab || !rootPath || !renameDraft.trim()) return;
    const origin = editorLocation(codeTab.id);
    if (!origin) return;
    setRenameBusy(true);
    try {
      const edit = await renameForEditor(codeTab.id, renameDraft.trim());
      if (!edit) return;
      const oldName = editorWord(codeTab.id) || "symbol";
      const id = `rename:${Date.now()}`;
      await prepareWorkspaceEdit(id, rootPath, `Rename: ${oldName} → ${renameDraft.trim()}`, edit);
      setRenameOpen(false);
      openMultibuffer({
        id,
        kind: "rename",
        title: `Rename: ${oldName} → ${renameDraft.trim()}`,
        origin,
        expired: true,
      });
    } finally {
      setRenameBusy(false);
    }
  }, [codeTab, openMultibuffer, renameDraft, rootPath]);

  const editorCommands = useMemo<CodeCommand[]>(
    () => [
      {
        id: "rename-symbol",
        label: "Rename symbol",
        shortcutCommandId: "code.rename",
        run: startRename,
      },
      {
        id: "find-references",
        label: "Find all references",
        shortcutCommandId: "code.references",
        run: openReferences,
      },
      {
        id: "code-actions",
        label: "Code actions",
        shortcutCommandId: "code.code_actions",
        run: openCodeActions,
      },
      {
        id: "document-symbols",
        label: "Document symbols",
        shortcutCommandId: "code.document_symbols",
        run: openOutline,
      },
      {
        id: "select-next",
        label: "Select next occurrence",
        shortcutCommandId: "code.select_next_occurrence",
        run: () => codeTab && runEditorSelectionAction(codeTab.id, "select-next"),
      },
      {
        id: "select-all",
        label: "Select all occurrences",
        shortcutCommandId: "code.select_all_occurrences",
        run: () => codeTab && runEditorSelectionAction(codeTab.id, "select-all"),
      },
      {
        id: "cursor-above",
        label: "Add cursor above",
        shortcutCommandId: "code.add_cursor_above",
        run: () => codeTab && runEditorSelectionAction(codeTab.id, "cursor-above"),
      },
      {
        id: "cursor-below",
        label: "Add cursor below",
        shortcutCommandId: "code.add_cursor_below",
        run: () => codeTab && runEditorSelectionAction(codeTab.id, "cursor-below"),
      },
    ],
    [codeTab, openCodeActions, openOutline, openReferences, startRename],
  );
  const displayedCommands = [...commands, ...editorCommands];
  useEffect(() => {
    const runShortcut = (commandId: string) => {
      if (!codeTab) return;
      const workspace = useWorkspaceStore.getState();
      if (commandId === "code.quick_open") setCommandMode("files");
      else if (commandId === "code.command_palette") setCommandMode("commands");
      else if (commandId === "code.search_project") setCommandMode("search");
      else if (commandId === "code.harpoon") setCommandMode("harpoon");
      else if (commandId === "code.inline_ai") requestInlineAi(codeTab.id);
      else if (commandId === "code.previous_file") previousFile();
      else if (commandId === "code.toggle_explorer") workspace.toggleSidebar(codeTab.id);
      else if (commandId === "code.toggle_terminal") toggleTerminal();
      else if (commandId === "navigation.back") navigateHistory(-1);
      else if (commandId === "navigation.forward") navigateHistory(1);
      else if (commandId === "code.references") openReferences();
      else if (commandId === "code.rename") startRename();
      else if (commandId === "code.code_actions") openCodeActions();
      else if (commandId === "code.document_symbols") openOutline();
      else if (commandId === "code.select_next_occurrence")
        runEditorSelectionAction(codeTab.id, "select-next");
      else if (commandId === "code.select_all_occurrences")
        runEditorSelectionAction(codeTab.id, "select-all");
      else if (commandId === "code.add_cursor_above")
        runEditorSelectionAction(codeTab.id, "cursor-above");
      else if (commandId === "code.add_cursor_below")
        runEditorSelectionAction(codeTab.id, "cursor-below");
      else if (commandId === "code.undo_selection")
        runEditorSelectionAction(codeTab.id, "undo-selection");
      else if (commandId.startsWith("code.mark_") && rootPath && project) {
        const target = project.marks[Number(commandId.slice(-1)) - 1];
        if (target) openFile(target, basename(target));
      }
    };
    const enabled = () => {
      if (!codeTab) return false;
      const workspace = useWorkspaceStore.getState();
      const focused = dockLeaves(workspace.layout.root).find(
        (pane) => pane.id === workspace.layout.focusedPaneId,
      );
      return focused?.activeTabId === codeTab.id;
    };
    const commandIds = [
      "code.quick_open",
      "code.command_palette",
      "code.search_project",
      "code.harpoon",
      "code.inline_ai",
      "code.previous_file",
      "code.toggle_explorer",
      "code.toggle_terminal",
      "navigation.back",
      "navigation.forward",
      "code.references",
      "code.rename",
      "code.code_actions",
      "code.document_symbols",
      "code.select_next_occurrence",
      "code.select_all_occurrences",
      "code.add_cursor_above",
      "code.add_cursor_below",
      "code.undo_selection",
      "code.mark_1",
      "code.mark_2",
      "code.mark_3",
      "code.mark_4",
    ];
    const unregister = commandIds.map((commandId) =>
      registerShortcutHandler(commandId, () => runShortcut(commandId), enabled),
    );
    return () => unregister.forEach((remove) => remove());
  }, [
    codeTab,
    openCodeActions,
    openFile,
    openOutline,
    openReferences,
    navigateHistory,
    previousFile,
    project,
    rootPath,
    startRename,
    toggleTerminal,
  ]);
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
      const { path, viewId, ranges } = inlineRequest;
      window.dispatchEvent(
        new CustomEvent("misty:code-inline-apply", {
          detail: { path, viewId, ranges, text },
        }),
      );
      const store = useCodingWorkspaceStore.getState();
      const buffer = store.projectBuffers[rootPath]?.[path];
      if (buffer) {
        const contents = [...ranges]
          .sort((a, b) => b.from - a.from)
          .reduce(
            (current, range) => current.slice(0, range.from) + text + current.slice(range.to),
            buffer.contents,
          );
        store.updateBufferContents(rootPath, path, contents);
      }
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
        <OpenFolderCard onOpenRoot={setRoot} />
      </section>
    );

  return (
    <section
      data-editor-theme={editorAppearance.theme}
      data-interface-scale={editorAppearance.interfaceScale}
      className="coding-workspace relative grid h-full min-h-0 bg-charcoal-workspace"
    >
      <div className="absolute right-2 top-2 z-50 rounded bg-charcoal-workspace/90">
        <AiSurfaceButton />
      </div>
      <CodeCommandCenter
        viewId={codeTab.id}
        rootPath={rootPath}
        activePath={activeBuffer?.path ?? null}
        symbolContext={symbolContext}
        mode={commandMode}
        onModeChange={setCommandMode}
        onOpenFile={openFile}
        onOpenFileInNewTab={openFileInNewTab}
        onPreviousFile={() => navigateHistory(-1)}
        onNextFile={() => navigateHistory(1)}
        canGoBack={navigation.canGoBack}
        canGoForward={navigation.canGoForward}
        onOpenSearchResults={openSearchResults}
        commands={displayedCommands}
        topActions={codeTopActions({
          active: Boolean(activeBuffer),
          menu: topActionMenu,
          labels: {
            outline: documentSymbolsTitle,
            actions: codeActionsTitle,
            inlineAi: inlineAiTitle,
          },
          outlineCommands,
          codeActionCommands,
          openOutline,
          openCodeActions,
          openInlineAi: () => requestInlineAi(codeTab.id),
          openMore: () => setCommandMode("commands"),
          closeMenu: () => setTopActionMenu(null),
        })}
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
            {multibufferSpec ? (
              <CodeMultibuffer
                viewId={codeTab.id}
                rootPath={rootPath}
                spec={multibufferSpec}
                onOpenFile={openFile}
                onOpenFileInNewTab={openFileInNewTab}
              />
            ) : activeBuffer ? (
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
        onOpenDiagnostics={openDiagnostics}
        onOpenAi={openModelsSettings}
        onOpenExtensions={openExtensions}
      />
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="code-theme-overlay max-w-sm">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitRename();
            }}
            className="grid gap-4"
          >
            <DialogHeader>
              <DialogTitle>Rename symbol</DialogTitle>
              <DialogDescription>
                Language-aware changes will open in a reviewable multibuffer.
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              aria-label="New symbol name"
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={!renameDraft.trim() || renameBusy}>
                {renameBusy ? "Preparing…" : "Preview rename"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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

function flattenDocumentSymbols(
  symbols: DocumentSymbol[],
  depth = 0,
): Array<{ symbol: DocumentSymbol; depth: number }> {
  return symbols.flatMap((symbol) => [
    { symbol, depth },
    ...flattenDocumentSymbols(symbol.children ?? [], depth + 1),
  ]);
}
