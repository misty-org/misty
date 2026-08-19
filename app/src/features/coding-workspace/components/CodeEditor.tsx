import { autocompletion, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import {
  forceLinting,
  forEachDiagnostic,
  lintGutter,
  lintKeymap,
  setDiagnosticsEffect,
} from "@codemirror/lint";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  ViewPlugin,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
} from "@codemirror/view";
import { useEffect, useMemo, useRef } from "react";
import { gitGutter, pushGitDiff } from "../git/gitGutter";
import { useGitStore } from "../git/useGitStore";
import { formatDocument, lspExtension } from "../lsp/codeMirrorLsp";
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
  buildConfigurableExtensions,
  reconfigureEditorPreferences,
  type EditorCompartments,
} from "./editorCompartments";

const CONTENT_DEBOUNCE_MS = 400;
const CURSOR_THROTTLE_MS = 100;

interface CodeEditorProps {
  tab: OpenTab;
  groupId: string;
  rootPath: string;
}

export function CodeEditor({ tab, groupId, rootPath }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const compartmentsRef = useRef<EditorCompartments | null>(null);

  const editorPrefs = useSettingsStore(
    useShallow((state) => selectEditorPreferences(state.settings?.document)),
  );
  const editorPrefsRef = useRef(editorPrefs);
  editorPrefsRef.current = editorPrefs;

  const gitDiff = useGitStore((state) => state.diffs[tab.path]);
  const refreshDiff = useGitStore((state) => state.refreshDiff);

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
      extensions: buildExtensions({
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

    reportCursor(view, groupId);
    reportDiagnostics(view, groupId);

    const diffTimer = rootPath
      ? window.setTimeout(() => void refreshDiff(rootPath, tab.path), 200)
      : null;

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
      if (diffTimer !== null) window.clearTimeout(diffTimer);
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

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    pushGitDiff(view, gitDiff ?? null);
  }, [gitDiff]);

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
        <div>
          <p className="text-sm text-[#d68b80]">Could not open {tab.name}</p>
          <p className="mt-2 text-xs text-cream-muted">{tab.error}</p>
        </div>
      </div>
    );
  }
  return <div ref={hostRef} className="code-theme-editor h-full min-h-0 w-full bg-charcoal-bg" />;
}

interface BuildOpts {
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
}

function buildExtensions({
  languageCompartment,
  compartments,
  editorPrefs,
  editorPrefsRef,
  linters,
  lspExtensions,
  basicAutocomplete,
  path,
  groupId,
  readonly,
  rootPath,
}: BuildOpts): Extension[] {
  let pendingContentTimer: number | null = null;
  let pendingAutosaveTimer: number | null = null;
  let lastCursorAt = 0;
  let cursorScheduled: number | null = null;

  const flushContent = (view: EditorView) => {
    if (pendingContentTimer !== null) {
      window.clearTimeout(pendingContentTimer);
      pendingContentTimer = null;
    }
    const store = useCodingWorkspaceStore.getState();
    const tab = store.projectBuffers[rootPath]?.[path];
    if (!tab) return;
    const current = view.state.doc.toString();
    if (current === tab.contents) return;
    store.updateBufferContents(rootPath, path, current);
  };

  const scheduleContent = (view: EditorView) => {
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
      void saveTab(path, view, editorPrefsRef.current, rootPath);
    }, delay);
  };

  const scheduleCursor = (view: EditorView) => {
    const now = performance.now();
    const elapsed = now - lastCursorAt;
    if (elapsed >= CURSOR_THROTTLE_MS) {
      lastCursorAt = now;
      reportCursor(view, groupId);
      return;
    }
    if (cursorScheduled !== null) return;
    cursorScheduled = window.setTimeout(() => {
      cursorScheduled = null;
      lastCursorAt = performance.now();
      reportCursor(view, groupId);
    }, CURSOR_THROTTLE_MS - elapsed);
  };

  const extensions: Extension[] = [
    ...buildConfigurableExtensions(compartments, editorPrefs),
    foldGutter(),
    gitGutter(),
    history(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    drawSelection(),
    ...(basicAutocomplete ? [autocompletion({ activateOnTyping: true, closeOnBlur: true })] : []),
    lintGutter(),
    languageCompartment.of([]),
    ...linters,
    ...lspExtensions,
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...foldKeymap,
      ...lintKeymap,
      {
        key: "Mod-s",
        preventDefault: true,
        run: (view) => {
          void saveTab(path, view, editorPrefsRef.current, rootPath);
          return true;
        },
      },
      {
        key: "Mod-k",
        preventDefault: true,
        run: (view) => {
          const { from, to } = view.state.selection.main;
          const selection = view.state.sliceDoc(from, to);
          window.dispatchEvent(
            new CustomEvent("misty:code-inline-ai", {
              detail: {
                path,
                viewId: groupId,
                selection,
                from,
                to,
              },
            }),
          );
          return true;
        },
      },
    ]),
    EditorState.readOnly.of(readonly),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        scheduleContent(update.view);
        scheduleAutosave(update.view);
      }
      if (update.selectionSet || update.docChanged) scheduleCursor(update.view);
      const diagnosticsChanged = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(setDiagnosticsEffect)),
      );
      if (diagnosticsChanged) reportDiagnostics(update.view, groupId);
    }),
    ViewPlugin.define(() => ({
      destroy() {
        if (pendingContentTimer !== null) window.clearTimeout(pendingContentTimer);
        if (pendingAutosaveTimer !== null) window.clearTimeout(pendingAutosaveTimer);
        if (cursorScheduled !== null) window.clearTimeout(cursorScheduled);
      },
    })),
    EditorView.focusChangeEffect.of((state, focused) => {
      if (!focused) {
        // Flush pending doc changes so the store's view of `contents`
        // catches up before another surface reads it.
        const view = viewByGroup.get(groupId);
        if (view) flushContent(view);
      }
      void state;
      return null;
    }),
  ];
  return extensions;
}

// Registry of live EditorView per group so extension closures can grab the
// latest view when flushing content on blur.
const viewByGroup = new Map<string, EditorView>();

function reportCursor(view: EditorView, groupId: string) {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  useEditorEphemeralStore.getState().setCursor(groupId, {
    line: line.number,
    column: head - line.from + 1,
  });
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
    if (rootPath) {
      void useGitStore.getState().refresh(rootPath);
      void useGitStore.getState().refreshDiff(rootPath, path);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save file.";
    state.patchBuffer(rootPath, path, { error: message });
  }
}
