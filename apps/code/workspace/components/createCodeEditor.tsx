import { addCursorAbove, addCursorBelow, undoSelection } from "@codemirror/commands";
import { forceLinting, forEachDiagnostic } from "@codemirror/lint";
import { selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useMemo, useRef } from "react";
import type { createCodeMirrorLsp } from "../lsp/createCodeMirrorLsp";
import { offsetToPosition, type DocumentSymbol, type LspCodeAction } from "../lsp/lspOperations";
import type { OpenTab } from "../store/createCodingWorkspaceStore";
import type { createCodingWorkspaceStore } from "../store/createCodingWorkspaceStore";
import type { createEditorEphemeralStore } from "../store/createEditorEphemeralStore";
import { loadCodeMirrorLanguage } from "./codeMirrorLanguages";
import { lintersFor } from "./linters";
import type { EditorPreferences } from "@/features/settings";
import {
  createEditorCompartments,
  reconfigureEditorPreferences,
  type EditorCompartments,
} from "./editorCompartments";
import { buildCodeEditorExtensions } from "./codeEditorExtensions";

export interface CodeEditorServices {
  store: ReturnType<typeof createCodingWorkspaceStore>;
  editorStore: ReturnType<typeof createEditorEphemeralStore>;
  lsp: Pick<
    ReturnType<typeof createCodeMirrorLsp>,
    | "codeActions"
    | "documentSymbols"
    | "executeLspCommand"
    | "formatDocument"
    | "lspExtension"
    | "renameSymbol"
    | "showSymbolInformation"
    | "goToDefinition"
  >;
  usePreferences(): EditorPreferences;
  useShortcutHandler(
    id: "code.save" | "code.go_to_definition" | "code.format_document" | "code.show_hover",
    run: () => void,
    active: () => boolean,
  ): void;
  writeFile(
    root: string,
    path: string,
    contents: string,
    lineEnding: "lf" | "crlf",
  ): Promise<unknown>;
  events: EventTarget;
  immediateContent?: boolean;
  writeOwnsSavedState?: boolean;
  registerBufferFlusher?(root: string, path: string, viewId: string, flush: () => void): () => void;
  pendingContent?(root: string, path: string, viewId: string, pending: boolean): void;
  ErrorActivity: React.ComponentType<{
    error: string;
    scope: string;
    title: string;
    target: { kind: "route"; href: string };
  }>;
}

/** The full editor, with live views and effects owned by its caller's runtime. */
export function createCodeEditor(services: CodeEditorServices) {
  const {
    store,
    editorStore,
    events,
    ErrorActivity: SystemErrorActivity,
    useShortcutHandler,
  } = services;
  const {
    codeActions,
    documentSymbols,
    executeLspCommand,
    formatDocument,
    lspExtension,
    renameSymbol,
    showSymbolInformation,
    goToDefinition,
  } = services.lsp;
  let closed = false;
  const pendingSaves = new Map<string, Promise<void>>();
  const flushers = new Map<string, { root: string; path: string; flush(): void }>();
  const pendingGroups = new Set<string>();
  const disposeViews = new Set<() => void>();
  interface CodeEditorProps {
    tab: OpenTab;
    groupId: string;
    rootPath: string;
  }

  function CodeEditor({ tab, groupId, rootPath }: CodeEditorProps) {
    const openingFailed = Boolean(tab.error && !tab.loaded);
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const compartmentsRef = useRef<EditorCompartments | null>(null);
    const editorFocused = () => Boolean(viewRef.current?.hasFocus);

    useShortcutHandler(
      "code.save",
      () => {
        const view = viewRef.current;
        if (view) void saveTab(tab.path, view, editorPrefsRef.current, rootPath);
      },
      editorFocused,
    );
    useShortcutHandler(
      "code.go_to_definition",
      () => {
        const view = viewRef.current;
        if (view) void goToDefinition(view, tab.path, rootPath, groupId);
      },
      editorFocused,
    );
    useShortcutHandler(
      "code.format_document",
      () => {
        const view = viewRef.current;
        if (view) void formatDocument(view, tab.path, rootPath);
      },
      editorFocused,
    );
    useShortcutHandler(
      "code.show_hover",
      () => {
        const view = viewRef.current;
        if (view) void showSymbolInformation(view, tab.path, rootPath);
      },
      editorFocused,
    );

    const editorPrefs = services.usePreferences();
    const editorPrefsRef = useRef(editorPrefs);
    editorPrefsRef.current = editorPrefs;

    const lintExtensions = useMemo(() => lintersFor(tab.name), [tab.name]);
    const lspExtensions = useMemo(() => {
      if (!rootPath) return [];
      return lspExtension(tab.path, rootPath, groupId);
    }, [groupId, tab.path, rootPath]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view || !compartmentsRef.current) return;
      reconfigureEditorPreferences(view, compartmentsRef.current, editorPrefs);
    }, [editorPrefs]);

    useEffect(() => {
      const host = hostRef.current;
      if (closed || !host || tab.loading || openingFailed) return;

      const compartments = createEditorCompartments();
      compartmentsRef.current = compartments;
      const languageCompartment = new Compartment();
      let liveView: EditorView | undefined;
      let disposed = false;
      const state = EditorState.create({
        doc: tab.contents,
        extensions: buildCodeEditorExtensions({
          store,
          immediateContent: services.immediateContent,
          languageCompartment,
          compartments,
          editorPrefs,
          editorPrefsRef,
          linters: lintExtensions,
          lspExtensions,
          basicAutocomplete: lspExtensions.length === 0,
          path: tab.path,
          groupId,
          readonly: tab.readonly,
          rootPath,
          getLiveView: () => liveView,
          onCursor: (view) => reportCursor(view, groupId),
          onDiagnostics: (view) => reportDiagnostics(view, groupId),
          onInlineAi: (view) => dispatchInlineAi(view, tab.path, groupId),
          onSave: (view) => void saveTab(tab.path, view, editorPrefsRef.current, rootPath),
          registerFlusher: (flush) => {
            const entry = { root: rootPath, path: tab.path, flush };
            flushers.set(groupId, entry);
            const remove = services.registerBufferFlusher?.(rootPath, tab.path, groupId, flush);
            return () => {
              remove?.();
              if (flushers.get(groupId) === entry) {
                flushers.delete(groupId);
                pendingGroups.delete(groupId);
              }
            };
          },
          onPendingContent: (pending) => {
            if (pending) pendingGroups.add(groupId);
            else pendingGroups.delete(groupId);
            services.pendingContent?.(rootPath, tab.path, groupId, pending);
          },
        }),
      });
      const view = new EditorView({ state, parent: host });
      liveView = view;
      viewRef.current = view;
      viewByGroup.set(groupId, view);
      const focusFrame = window.requestAnimationFrame(() => view.focus());

      // The editor can paint and accept input before the file's parser chunk is
      // downloaded/evaluated. Reconfigure just the language slot when ready.
      void loadCodeMirrorLanguage(tab.name).then((language) => {
        if (disposed || !language) return;
        view.dispatch({ effects: languageCompartment.reconfigure(language) });
        forceLinting(view);
      });
      if (rootPath) {
        void documentSymbols(tab.path, rootPath).then((symbols) => {
          if (disposed) return;
          symbolsByGroup.set(groupId, flattenSymbols(symbols));
          reportCursor(view, groupId);
        });
      }

      reportCursor(view, groupId);
      reportDiagnostics(view, groupId);

      const handleGoto = (event: Event) => {
        const detail = (event as CustomEvent<{ path: string; line: number; viewId?: string }>)
          .detail;
        if (!detail || detail.path !== tab.path) return;
        if (detail.viewId && detail.viewId !== groupId) return;
        const doc = view.state.doc;
        const targetLine = Math.min(Math.max(1, detail.line), doc.lines);
        const line = doc.line(targetLine);
        view.dispatch({
          selection: { anchor: line.from, head: line.from },
          scrollIntoView: true,
        });
        view.focus();
      };
      events.addEventListener("misty:code-goto-line", handleGoto);

      const dispose = () => {
        if (disposed) return;
        disposed = true;
        // Late blur callbacks belong to this document, never its replacement in the same tab.
        liveView = undefined;
        disposeViews.delete(dispose);
        window.cancelAnimationFrame(focusFrame);
        events.removeEventListener("misty:code-goto-line", handleGoto);
        // Flush any pending debounced content update before tearing down the
        // view so the store's copy of `contents` reflects the final doc.
        const current = view.state.doc.toString();
        const state = store.getState();
        const tabInStore = state.projectBuffers[rootPath]?.[tab.path];
        if (pendingGroups.has(groupId) && tabInStore && tabInStore.contents !== current) {
          state.updateBufferContents(rootPath, tab.path, current);
        }
        services.pendingContent?.(rootPath, tab.path, groupId, false);
        view.destroy();
        viewRef.current = null;
        if (viewByGroup.get(groupId) === view) viewByGroup.delete(groupId);
        symbolsByGroup.delete(groupId);
      };
      disposeViews.add(dispose);
      return dispose;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      tab.path,
      tab.loading,
      openingFailed,
      tab.readonly,
      lintExtensions,
      lspExtensions,
      groupId,
      rootPath,
    ]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const contents = store.getState().projectBuffers[rootPath]?.[tab.path]?.contents;
      if (contents === undefined || view.state.doc.toString() === contents) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: contents },
      });
    }, [tab.contents, tab.path, rootPath]);

    if (tab.loading) {
      return (
        <div className="grid h-full place-items-center bg-charcoal-bg text-xs italic text-cream-muted">
          Opening {tab.name}…
        </div>
      );
    }
    if (openingFailed) {
      return (
        <div className="grid h-full place-items-center bg-charcoal-bg px-6 text-center">
          <SystemErrorActivity
            error={tab.error!}
            scope={`code:file:${tab.path}`}
            title={`${tab.name} could not be opened`}
            target={{ kind: "route", href: "/code" }}
          />
          <div>
            <p className="text-sm text-[#d68b80]">Could not open {tab.name}</p>
            <p className="mt-2 text-xs text-cream-muted">Open Activity for details.</p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-full min-h-0 flex-col bg-charcoal-bg">
        {tab.error && (
          <div
            role="alert"
            className="shrink-0 border-b border-border px-3 py-2 text-xs text-cream-muted"
          >
            {tab.error}
            <SystemErrorActivity
              error={tab.error}
              scope={`code:file:${tab.path}`}
              title={`${tab.name} needs attention`}
              target={{ kind: "route", href: "/code" }}
            />
          </div>
        )}
        <div ref={hostRef} className="code-theme-editor min-h-0 w-full flex-1" />
      </div>
    );
  }

  // Registry of live EditorView per group so extension closures can grab the
  // latest view when flushing content on blur.
  const viewByGroup = new Map<string, EditorView>();
  const symbolsByGroup = new Map<string, DocumentSymbol[]>();

  function requestInlineAi(viewId: string): boolean {
    const view = viewByGroup.get(viewId);
    if (!view) return false;
    const state = store.getState();
    const viewport = state.views[viewId];
    if (!viewport?.activeFilePath) return false;
    dispatchInlineAi(view, viewport.activeFilePath, viewId);
    return true;
  }

  function runEditorSelectionAction(
    viewId: string,
    action: "select-next" | "select-all" | "cursor-above" | "cursor-below" | "undo-selection",
  ) {
    const view = viewByGroup.get(viewId);
    if (!view) return false;
    const command = {
      "select-next": selectNextOccurrence,
      "select-all": selectSelectionMatches,
      "cursor-above": addCursorAbove,
      "cursor-below": addCursorBelow,
      "undo-selection": undoSelection,
    }[action];
    return command(view);
  }

  function editorLocation(viewId: string) {
    const context = liveEditorContext(viewId);
    if (!context) return null;
    const position = offsetToPosition(
      context.view.state.doc,
      context.view.state.selection.main.head,
    );
    return { path: context.path, line: position.line, character: position.character };
  }

  function editorWord(viewId: string) {
    const context = liveEditorContext(viewId);
    if (!context) return "";
    const { state } = context.view;
    const selected = state.sliceDoc(state.selection.main.from, state.selection.main.to);
    if (selected) return selected;
    const word = state.wordAt(state.selection.main.head);
    return word ? state.sliceDoc(word.from, word.to) : "";
  }

  async function documentSymbolsForEditor(viewId: string): Promise<DocumentSymbol[]> {
    const context = liveEditorContext(viewId);
    return context ? documentSymbols(context.path, context.rootPath) : [];
  }

  async function codeActionsForEditor(viewId: string): Promise<LspCodeAction[]> {
    const context = liveEditorContext(viewId);
    return context ? codeActions(context.view, context.path, context.rootPath) : [];
  }

  async function renameForEditor(viewId: string, newName: string) {
    const context = liveEditorContext(viewId);
    return context ? renameSymbol(context.view, context.path, context.rootPath, newName) : null;
  }

  async function executeCodeActionCommand(viewId: string, action: LspCodeAction) {
    const context = liveEditorContext(viewId);
    if (context && action.command)
      await executeLspCommand(context.path, context.rootPath, action.command);
  }

  function liveEditorContext(viewId: string) {
    const view = viewByGroup.get(viewId);
    const viewport = store.getState().views[viewId];
    if (!view || !viewport?.activeFilePath || !viewport.rootPath) return null;
    return { view, path: viewport.activeFilePath, rootPath: viewport.rootPath };
  }

  function dispatchInlineAi(view: EditorView, path: string, viewId: string) {
    const ranges = view.state.selection.ranges.map(({ from, to }) => ({ from, to }));
    const selections = ranges.map(({ from, to }) => view.state.sliceDoc(from, to));
    events.dispatchEvent(
      new CustomEvent("misty:code-inline-ai", {
        detail: {
          path,
          viewId,
          selection:
            selections.length === 1 ? selections[0] : selections.join("\n\n--- selection ---\n\n"),
          ranges,
        },
      }),
    );
  }

  function reportCursor(view: EditorView, groupId: string) {
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    editorStore.getState().setCursor(groupId, {
      line: line.number,
      column: head - line.from + 1,
    });
    const position = offsetToPosition(view.state.doc, head);
    const symbol = symbolsByGroup
      .get(groupId)
      ?.filter((candidate) => rangeContains(candidate.range, position.line, position.character))
      .sort((a, b) => rangeSpan(a.range) - rangeSpan(b.range))[0];
    editorStore.getState().setSymbolContext(groupId, symbol?.name ?? null);
  }

  function flattenSymbols(symbols: DocumentSymbol[]): DocumentSymbol[] {
    return symbols.flatMap((symbol) => [symbol, ...flattenSymbols(symbol.children ?? [])]);
  }

  function rangeContains(range: DocumentSymbol["range"], line: number, character: number) {
    const afterStart =
      line > range.start.line || (line === range.start.line && character >= range.start.character);
    const beforeEnd =
      line < range.end.line || (line === range.end.line && character <= range.end.character);
    return afterStart && beforeEnd;
  }

  function rangeSpan(range: DocumentSymbol["range"]) {
    return (
      (range.end.line - range.start.line) * 1_000_000 + range.end.character - range.start.character
    );
  }

  function reportDiagnostics(view: EditorView, groupId: string) {
    let errors = 0;
    let warnings = 0;
    forEachDiagnostic(view.state, (diagnostic) => {
      if (diagnostic.severity === "error") errors += 1;
      else if (diagnostic.severity === "warning") warnings += 1;
    });
    editorStore.getState().setDiagnostics(groupId, { errors, warnings });
  }

  async function saveTab(
    path: string,
    view: EditorView,
    prefs: EditorPreferences,
    rootPath: string,
  ) {
    if (closed) return;
    const state = store.getState();
    const tab = state.projectBuffers[rootPath]?.[path];
    if (!tab || tab.readonly) return;
    if (prefs.formatOnSave && rootPath) {
      try {
        await formatDocument(view, path, rootPath, prefs.tabSize);
      } catch {
        /* formatting errors should not block saving */
      }
    }
    if (closed || ![...viewByGroup.values()].includes(view)) return;
    const contents = view.state.doc.toString();
    state.updateBufferContents(rootPath, path, contents);
    const key = JSON.stringify([rootPath, path]);
    const previous = pendingSaves.get(key) ?? Promise.resolve();
    const pending = previous
      .catch(() => undefined)
      .then(async () => {
        if (closed) return;
        try {
          await services.writeFile(rootPath, path, contents, tab.lineEnding);
          if (
            !closed &&
            !services.writeOwnsSavedState &&
            store.getState().projectBuffers[rootPath]?.[path]
          )
            store.getState().patchBuffer(rootPath, path, { savedContents: contents, error: null });
        } catch (error) {
          if (
            !closed &&
            !services.writeOwnsSavedState &&
            store.getState().projectBuffers[rootPath]?.[path]
          )
            store.getState().patchBuffer(rootPath, path, {
              error: error instanceof Error ? error.message : "Could not save file.",
            });
        }
      });
    pendingSaves.set(key, pending);
    await pending;
    if (pendingSaves.get(key) === pending) pendingSaves.delete(key);
  }
  return {
    CodeEditor,
    flushBuffer(root: string, path: string) {
      if (closed) throw new Error("This Code editor is closed.");
      for (const group of [...pendingGroups]) {
        const entry = flushers.get(group);
        if (entry?.root === root && entry.path === path) entry.flush();
      }
    },
    requestInlineAi,
    runEditorSelectionAction,
    editorLocation,
    editorWord,
    documentSymbolsForEditor,
    codeActionsForEditor,
    renameForEditor,
    executeCodeActionCommand,
    close() {
      if (closed) return;
      closed = true;
      for (const dispose of [...disposeViews]) dispose();
      viewByGroup.clear();
      symbolsByGroup.clear();
      pendingSaves.clear();
      flushers.clear();
      pendingGroups.clear();
    },
  };
}
