import { addCursorAbove, addCursorBelow, undoSelection } from "@codemirror/commands";
import { forceLinting, forEachDiagnostic } from "@codemirror/lint";
import { SystemErrorActivity } from "@/features/activity";
import { selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useMemo, useRef } from "react";
import {
  codeActions,
  documentSymbols,
  executeLspCommand,
  formatDocument,
  lspExtension,
  offsetToPosition,
  renameSymbol,
  showSymbolInformation,
  type DocumentSymbol,
  type LspCodeAction,
} from "../lsp/codeMirrorLsp";
import type { OpenTab } from "../store/useCodingWorkspaceStore";
import { useCodingWorkspaceStore } from "../store/useCodingWorkspaceStore";
import { useEditorEphemeralStore } from "../store/useEditorEphemeralStore";
import { codeWriteTextFile } from "../native";
import { loadCodeMirrorLanguage } from "./codeMirrorLanguages";
import { lintersFor } from "./linters";
import {
  selectEditorPreferences,
  type EditorPreferences,
  useSettingsStore,
} from "@/features/settings";
import { useShallow } from "zustand/react/shallow";
import {
  createEditorCompartments,
  reconfigureEditorPreferences,
  type EditorCompartments,
} from "./editorCompartments";
import { buildCodeEditorExtensions } from "./codeEditorExtensions";
import { useShortcutHandler } from "@/features/shortcuts";
import { goToDefinition } from "../lsp/codeMirrorLsp";

interface CodeEditorProps {
  tab: OpenTab;
  groupId: string;
  rootPath: string;
}

export function CodeEditor({ tab, groupId, rootPath }: CodeEditorProps) {
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

  const editorPrefs = useSettingsStore(
    useShallow((state) => selectEditorPreferences(state.settings?.document)),
  );
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
    if (!host || tab.loading || tab.error) return;

    const compartments = createEditorCompartments();
    compartmentsRef.current = compartments;
    const languageCompartment = new Compartment();
    const state = EditorState.create({
      doc: tab.contents,
      extensions: buildCodeEditorExtensions({
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
        getLiveView: () => viewByGroup.get(groupId),
        onCursor: (view) => reportCursor(view, groupId),
        onDiagnostics: (view) => reportDiagnostics(view, groupId),
        onInlineAi: (view) => dispatchInlineAi(view, tab.path, groupId),
        onSave: (view) => void saveTab(tab.path, view, editorPrefsRef.current, rootPath),
      }),
    });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    viewByGroup.set(groupId, view);
    let disposed = false;
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
      const detail = (event as CustomEvent<{ path: string; line: number }>).detail;
      if (!detail || detail.path !== tab.path) return;
      const doc = view.state.doc;
      const targetLine = Math.min(Math.max(1, detail.line), doc.lines);
      const line = doc.line(targetLine);
      view.dispatch({
        selection: { anchor: line.from, head: line.from },
        scrollIntoView: true,
      });
      view.focus();
    };
    window.addEventListener("misty:code-goto-line", handleGoto);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("misty:code-goto-line", handleGoto);
      // Flush any pending debounced content update before tearing down the
      // view so the store's copy of `contents` reflects the final doc.
      const current = view.state.doc.toString();
      const store = useCodingWorkspaceStore.getState();
      const tabInStore = store.projectBuffers[rootPath]?.[tab.path];
      if (tabInStore && tabInStore.contents !== current) {
        store.updateBufferContents(rootPath, tab.path, current);
      }
      view.destroy();
      viewRef.current = null;
      if (viewByGroup.get(groupId) === view) viewByGroup.delete(groupId);
      symbolsByGroup.delete(groupId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tab.path,
    tab.loading,
    tab.error,
    tab.readonly,
    lintExtensions,
    lspExtensions,
    groupId,
    rootPath,
  ]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() === tab.contents) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: tab.contents },
    });
  }, [tab.contents]);

  if (tab.loading) {
    return (
      <div className="grid h-full place-items-center bg-charcoal-bg text-xs italic text-cream-muted">
        Opening {tab.name}…
      </div>
    );
  }
  if (tab.error) {
    return (
      <div className="grid h-full place-items-center bg-charcoal-bg px-6 text-center">
        <SystemErrorActivity
          error={tab.error}
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
  return <div ref={hostRef} className="code-theme-editor h-full min-h-0 w-full bg-charcoal-bg" />;
}

// Registry of live EditorView per group so extension closures can grab the
// latest view when flushing content on blur.
const viewByGroup = new Map<string, EditorView>();
const symbolsByGroup = new Map<string, DocumentSymbol[]>();

export function requestInlineAi(viewId: string): boolean {
  const view = viewByGroup.get(viewId);
  if (!view) return false;
  const store = useCodingWorkspaceStore.getState();
  const viewport = store.views[viewId];
  if (!viewport?.activeFilePath) return false;
  dispatchInlineAi(view, viewport.activeFilePath, viewId);
  return true;
}

export function runEditorSelectionAction(
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

export function editorLocation(viewId: string) {
  const context = liveEditorContext(viewId);
  if (!context) return null;
  const position = offsetToPosition(context.view.state.doc, context.view.state.selection.main.head);
  return { path: context.path, line: position.line, character: position.character };
}

export function editorWord(viewId: string) {
  const context = liveEditorContext(viewId);
  if (!context) return "";
  const { state } = context.view;
  const selected = state.sliceDoc(state.selection.main.from, state.selection.main.to);
  if (selected) return selected;
  const word = state.wordAt(state.selection.main.head);
  return word ? state.sliceDoc(word.from, word.to) : "";
}

export async function documentSymbolsForEditor(viewId: string): Promise<DocumentSymbol[]> {
  const context = liveEditorContext(viewId);
  return context ? documentSymbols(context.path, context.rootPath) : [];
}

export async function codeActionsForEditor(viewId: string): Promise<LspCodeAction[]> {
  const context = liveEditorContext(viewId);
  return context ? codeActions(context.view, context.path, context.rootPath) : [];
}

export async function renameForEditor(viewId: string, newName: string) {
  const context = liveEditorContext(viewId);
  return context ? renameSymbol(context.view, context.path, context.rootPath, newName) : null;
}

export async function executeCodeActionCommand(viewId: string, action: LspCodeAction) {
  const context = liveEditorContext(viewId);
  if (context && action.command)
    await executeLspCommand(context.path, context.rootPath, action.command);
}

function liveEditorContext(viewId: string) {
  const view = viewByGroup.get(viewId);
  const viewport = useCodingWorkspaceStore.getState().views[viewId];
  if (!view || !viewport?.activeFilePath || !viewport.rootPath) return null;
  return { view, path: viewport.activeFilePath, rootPath: viewport.rootPath };
}

function dispatchInlineAi(view: EditorView, path: string, viewId: string) {
  const ranges = view.state.selection.ranges.map(({ from, to }) => ({ from, to }));
  const selections = ranges.map(({ from, to }) => view.state.sliceDoc(from, to));
  window.dispatchEvent(
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
  useEditorEphemeralStore.getState().setCursor(groupId, {
    line: line.number,
    column: head - line.from + 1,
  });
  const position = offsetToPosition(view.state.doc, head);
  const symbol = symbolsByGroup
    .get(groupId)
    ?.filter((candidate) => rangeContains(candidate.range, position.line, position.character))
    .sort((a, b) => rangeSpan(a.range) - rangeSpan(b.range))[0];
  useEditorEphemeralStore.getState().setSymbolContext(groupId, symbol?.name ?? null);
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
  useEditorEphemeralStore.getState().setDiagnostics(groupId, { errors, warnings });
}

async function saveTab(path: string, view: EditorView, prefs: EditorPreferences, rootPath: string) {
  const state = useCodingWorkspaceStore.getState();
  const tab = state.projectBuffers[rootPath]?.[path];
  if (!tab || tab.readonly) return;
  if (prefs.formatOnSave && rootPath) {
    try {
      await formatDocument(view, path, rootPath, prefs.tabSize);
    } catch {
      /* formatting errors should not block saving */
    }
  }
  const contents = view.state.doc.toString();
  try {
    await codeWriteTextFile(path, contents, tab.lineEnding);
    // Ensure the store's `contents` matches what we just saved so the dirty
    // flag settles (the debounced writer may not have flushed yet).
    if (tab.contents !== contents) state.updateBufferContents(rootPath, path, contents);
    state.markBufferSaved(rootPath, path);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save file.";
    state.patchBuffer(rootPath, path, { error: message });
  }
}
