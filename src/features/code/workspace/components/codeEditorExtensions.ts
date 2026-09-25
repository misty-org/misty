import { autocompletion, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, simplifySelection } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { lintGutter, lintKeymap, setDiagnosticsEffect } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState, type Compartment, type Extension } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  crosshairCursor,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  rectangularSelection,
} from "@codemirror/view";
import type { EditorPreferences } from "@/features/settings";
import type { createCodingWorkspaceStore } from "../store/createCodingWorkspaceStore";
import { buildConfigurableExtensions, type EditorCompartments } from "./editorCompartments";

const CONTENT_DEBOUNCE_MS = 400;
const CURSOR_THROTTLE_MS = 100;

interface BuildOpts {
  store: ReturnType<typeof createCodingWorkspaceStore>;
  languageCompartment: Compartment;
  compartments: EditorCompartments;
  editorPrefs: EditorPreferences;
  editorPrefsRef: React.MutableRefObject<EditorPreferences>;
  linters: Extension[];
  lspExtensions: Extension[];
  basicAutocomplete: boolean;
  path: string;
  groupId: string;
  readonly: boolean;
  rootPath: string;
  getLiveView: () => EditorView | undefined;
  onCursor: (view: EditorView) => void;
  onDiagnostics: (view: EditorView) => void;
  onInlineAi: (view: EditorView) => void;
  onSave: (view: EditorView) => void;
  registerFlusher?(flush: () => void): (() => void) | undefined;
  onPendingContent?: (pending: boolean) => void;
  immediateContent?: boolean;
}

export function buildCodeEditorExtensions(options: BuildOpts): Extension[] {
  const {
    languageCompartment,
    compartments,
    editorPrefs,
    editorPrefsRef,
    linters,
    lspExtensions,
    basicAutocomplete,
    path,
    readonly,
    rootPath,
  } = options;
  let pendingContentTimer: number | null = null;
  let pendingAutosaveTimer: number | null = null;
  let lastCursorAt = 0;
  let cursorScheduled: number | null = null;

  const flushContent = (view: EditorView) => {
    if (pendingContentTimer !== null) window.clearTimeout(pendingContentTimer);
    pendingContentTimer = null;
    const store = options.store.getState();
    const tab = store.projectBuffers[rootPath]?.[path];
    const current = view.state.doc.toString();
    if (tab && current !== tab.contents) store.updateBufferContents(rootPath, path, current);
    options.onPendingContent?.(false);
  };
  const scheduleContent = (view: EditorView) => {
    if (options.immediateContent) {
      flushContent(view);
      return;
    }
    if (pendingContentTimer !== null) window.clearTimeout(pendingContentTimer);
    pendingContentTimer = window.setTimeout(() => {
      pendingContentTimer = null;
      flushContent(view);
    }, CONTENT_DEBOUNCE_MS);
  };
  const scheduleAutosave = (view: EditorView) => {
    if (pendingAutosaveTimer !== null) window.clearTimeout(pendingAutosaveTimer);
    const delay = editorPrefsRef.current.autosaveDelayMs;
    if (delay <= 0) return;
    pendingAutosaveTimer = window.setTimeout(() => {
      pendingAutosaveTimer = null;
      options.onSave(view);
    }, delay);
  };
  const scheduleCursor = (view: EditorView) => {
    const elapsed = performance.now() - lastCursorAt;
    if (elapsed >= CURSOR_THROTTLE_MS) {
      lastCursorAt = performance.now();
      options.onCursor(view);
    } else if (cursorScheduled === null) {
      cursorScheduled = window.setTimeout(() => {
        cursorScheduled = null;
        lastCursorAt = performance.now();
        options.onCursor(view);
      }, CURSOR_THROTTLE_MS - elapsed);
    }
  };

  return [
    ...buildConfigurableExtensions(compartments, editorPrefs),
    foldGutter(),
    history(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection(),
    crosshairCursor(),
    highlightSelectionMatches(),
    ...(basicAutocomplete ? [autocompletion({ activateOnTyping: true, closeOnBlur: true })] : []),
    lintGutter(),
    languageCompartment.of([]),
    ...linters,
    ...lspExtensions,
    keymap.of([
      { key: "Escape", run: simplifySelection },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...foldKeymap,
      ...lintKeymap,
    ]),
    EditorState.readOnly.of(readonly),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        options.onPendingContent?.(true);
        scheduleContent(update.view);
        scheduleAutosave(update.view);
      }
      if (update.selectionSet || update.docChanged) scheduleCursor(update.view);
      if (
        update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setDiagnosticsEffect)),
        )
      )
        options.onDiagnostics(update.view);
    }),
    ViewPlugin.define((view) => {
      const remove = options.registerFlusher?.(() => flushContent(view));
      return {
        destroy() {
          remove?.();
          if (pendingContentTimer !== null) window.clearTimeout(pendingContentTimer);
          if (pendingAutosaveTimer !== null) window.clearTimeout(pendingAutosaveTimer);
          if (cursorScheduled !== null) window.clearTimeout(cursorScheduled);
        },
      };
    }),
    EditorView.focusChangeEffect.of((_state, focused) => {
      if (!focused) {
        const view = options.getLiveView();
        if (view) flushContent(view);
      }
      return null;
    }),
  ];
}
