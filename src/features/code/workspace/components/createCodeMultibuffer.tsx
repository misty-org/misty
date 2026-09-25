import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { lineNumbers } from "@codemirror/view";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { EditorState, Transaction, type ChangeSet } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  crosshairCursor,
  drawSelection,
  keymap,
  rectangularSelection,
  type DecorationSet,
} from "@codemirror/view";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { CodeMultibufferSpec } from "@/features/workspace";
import type { EditorPreferences } from "@/features/settings";
import { Button } from "@/shared/ui";
import type { SearchMatch, SearchOutcome, LineEnding } from "../native";
import type { createCodingWorkspaceStore } from "../store/createCodingWorkspaceStore";
import type { createEditorEphemeralStore } from "../store/createEditorEphemeralStore";
import type { CodeEditorServices } from "./createCodeEditor";
import type { findReferencesAt as References } from "../lsp/codeMirrorLsp";
import { uriToPath } from "../lsp/client";
import type { createWorkspaceEdits } from "../lsp/createWorkspaceEdits";
import { buildConfigurableExtensions, createEditorCompartments } from "./editorCompartments";
import {
  buildMultibufferDocument,
  type Excerpt,
  type MultibufferDocument,
} from "./multibufferDocument";
export { buildMultibufferDocument } from "./multibufferDocument";

export interface CodeMultibufferProps {
  viewId: string;
  rootPath: string;
  spec: CodeMultibufferSpec;
  onOpenFile: (path: string, name: string, line?: number) => void;
  onOpenFileInNewTab: (path: string, name: string, line?: number) => void;
}

export interface CodeMultibufferServices {
  store: ReturnType<typeof createCodingWorkspaceStore>;
  editorStore: ReturnType<typeof createEditorEphemeralStore>;
  usePreferences(): EditorPreferences;
  useShortcutHandler(
    id: string,
    run: () => boolean | void,
    enabled?: () => boolean,
    priority?: number,
  ): void;
  findInFiles(
    root: string,
    query: string,
    caseSensitive: boolean,
    signal?: AbortSignal,
  ): Promise<SearchOutcome>;
  ensureBuffer(root: string, path: string, name: string): Promise<unknown>;
  findReferencesAt: typeof References;
  edits: Pick<
    ReturnType<typeof createWorkspaceEdits>,
    "getWorkspaceEditPreview" | "applyWorkspaceEditPreview" | "discardWorkspaceEditPreview"
  >;
  saveFile(root: string, path: string, contents: string, ending: LineEnding): Promise<unknown>;
  report(error: unknown): void;
  ErrorActivity: CodeEditorServices["ErrorActivity"];
}
export function createCodeMultibuffer(services: CodeMultibufferServices) {
  const {
    store: useCodingWorkspaceStore,
    editorStore: useEditorEphemeralStore,
    useShortcutHandler,
    findInFiles: codeFindInFiles,
    ensureBuffer: ensureProjectBuffer,
    findReferencesAt,
    ErrorActivity: SystemErrorActivity,
  } = services;
  const { getWorkspaceEditPreview, applyWorkspaceEditPreview, discardWorkspaceEditPreview } =
    services.edits;
  function CodeMultibuffer(props: CodeMultibufferProps) {
    const [matches, setMatches] = useState<SearchMatch[]>([]);
    const [loading, setLoading] = useState(props.spec.kind === "search");
    const [error, setError] = useState<string | null>(null);
    const [previewVersion, setPreviewVersion] = useState(0);
    const [appliedPreview, setAppliedPreview] = useState<{
      id: string;
      files: readonly { path: string; changedLines: readonly number[] }[];
    } | null>(null);
    const buffers = useCodingWorkspaceStore(
      useShallow((state) => state.projectBuffers[props.rootPath] ?? {}),
    );
    const projectDiagnostics = useEditorEphemeralStore(
      useShallow((state) => state.projectDiagnostics[props.rootPath] ?? {}),
    );
    const preview = getWorkspaceEditPreview(props.spec.id);
    const review = preview ?? (appliedPreview?.id === props.spec.id ? appliedPreview : null);
    void previewVersion;
    const specKind = props.spec.kind;
    const searchQuery = props.spec.kind === "search" ? props.spec.query : "";
    const searchCaseSensitive = props.spec.kind === "search" && props.spec.caseSensitive;
    const referencePath = props.spec.kind === "references" ? props.spec.origin.path : "";
    const referenceLine = props.spec.kind === "references" ? props.spec.origin.line : 0;
    const referenceCharacter = props.spec.kind === "references" ? props.spec.origin.character : 0;

    useEffect(() => {
      let active = true;
      const cancellation = new AbortController();
      setLoading(true);
      setError(null);
      const load = async () => {
        if (specKind === "search") {
          return codeFindInFiles(
            props.rootPath,
            searchQuery,
            searchCaseSensitive,
            cancellation.signal,
          ).then((outcome) => outcome.matches);
        }
        if (specKind === "references" && referencePath) {
          const locations = await findReferencesAt(referencePath, props.rootPath, {
            line: referenceLine,
            character: referenceCharacter,
          });
          return locations.map((location) => {
            const path = uriToPath(location.uri);
            return {
              path,
              relative: path.slice(props.rootPath.length).replace(/^\//, ""),
              lineNumber: location.range.start.line + 1,
              line: "",
              column: location.range.start.character,
            };
          });
        }
        if (specKind === "diagnostics") {
          return Object.values(projectDiagnostics).flatMap((diagnostics) =>
            diagnostics.map((diagnostic) => ({
              path: diagnostic.path,
              relative: diagnostic.path.slice(props.rootPath.length).replace(/^\//, ""),
              lineNumber: diagnostic.fromLine + 1,
              line: diagnostic.message,
              column: diagnostic.fromCharacter,
            })),
          );
        }
        return (review?.files ?? []).flatMap((file) =>
          file.changedLines.map((lineNumber) => ({
            path: file.path,
            relative: file.path.slice(props.rootPath.length).replace(/^\//, ""),
            lineNumber,
            line: "",
            column: 0,
          })),
        );
      };
      void load()
        .then(async (outcome) => {
          if (!active) return;
          const paths = [...new Set(outcome.map((match) => match.path))];
          for (let offset = 0; offset < paths.length; offset += 4) {
            if (!active) return;
            await Promise.all(
              paths
                .slice(offset, offset + 4)
                .map((path) => ensureProjectBuffer(props.rootPath, path, basename(path))),
            );
          }
          if (active) setMatches(outcome);
        })
        .catch(
          (cause: unknown) =>
            active && setError(cause instanceof Error ? cause.message : "Could not build results."),
        )
        .finally(() => active && setLoading(false));
      return () => {
        active = false;
        cancellation.abort();
      };
    }, [
      review,
      projectDiagnostics,
      props.rootPath,
      referenceCharacter,
      referenceLine,
      referencePath,
      searchCaseSensitive,
      searchQuery,
      specKind,
    ]);

    const document = useMemo(
      () =>
        buildMultibufferDocument(
          props.rootPath,
          props.spec,
          matches,
          buffers,
          new Map(preview?.files.map((file) => [file.path, file.proposed]) ?? []),
        ),
      [buffers, matches, preview, props.rootPath, props.spec],
    );

    if (loading && document.excerpts.length === 0)
      return <ResultMessage>Building {props.spec.title}…</ResultMessage>;
    if (error)
      return (
        <>
          <SystemErrorActivity
            error={error}
            scope="code:multibuffer"
            title="Code results could not be prepared"
            target={{ kind: "route", href: "/code" }}
          />
          <ResultMessage>Open Activity for details.</ResultMessage>
        </>
      );
    if (document.excerpts.length === 0) {
      return <ResultMessage>{emptyMessage(props.spec)}</ResultMessage>;
    }

    const editor = (
      <MultibufferEditor
        key={preview ? "preview" : "editable"}
        {...props}
        document={document}
        readonly={Boolean(preview)}
      />
    );
    if (!preview) return editor;
    return (
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <div className="flex items-center gap-2 border-b border-charcoal-border bg-charcoal-sidebar px-3 py-1.5 text-xs">
          <span className="min-w-0 flex-1 truncate text-cream-muted">
            {preview.files.length} files will change. Applying leaves them unsaved.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              discardWorkspaceEditPreview(props.spec.id);
              setPreviewVersion((value) => value + 1);
            }}
          >
            <X size={13} />
            Discard
          </Button>
          <Button
            size="sm"
            onClick={() => {
              try {
                if (applyWorkspaceEditPreview(props.spec.id))
                  setAppliedPreview({
                    id: preview.id,
                    files: preview.files.map(({ path, changedLines }) => ({ path, changedLines })),
                  });
                setPreviewVersion((value) => value + 1);
              } catch (error) {
                services.report(error);
                setError(
                  error instanceof Error ? error.message : "This edit could not be applied.",
                );
              }
            }}
          >
            <Check size={13} />
            Apply
          </Button>
        </div>
        {editor}
      </div>
    );
  }

  function MultibufferEditor(
    props: CodeMultibufferProps & { document: MultibufferDocument; readonly: boolean },
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const excerptsRef = useRef(props.document.excerpts);
    useShortcutHandler(
      "code.save",
      () => void saveExcerptBuffers(props.rootPath, excerptsRef.current).catch(services.report),
      () => Boolean(viewRef.current?.hasFocus),
    );
    useShortcutHandler(
      "code.open_multibuffer_excerpt",
      () => {
        const view = viewRef.current;
        if (view) openSelectedExcerpts(view, excerptsRef.current, props.onOpenFileInNewTab);
      },
      () => Boolean(viewRef.current?.hasFocus),
    );
    const applyingRef = useRef(false);
    const editorPrefs = services.usePreferences();

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      const compartments = createEditorCompartments();
      excerptsRef.current = props.document.excerpts;
      const state = EditorState.create({
        doc: props.document.text,
        selection: props.document.excerpts[0]
          ? { anchor: props.document.excerpts[0].virtualFrom }
          : undefined,
        extensions: [
          ...buildConfigurableExtensions(compartments, editorPrefs),
          lineNumbers(),
          history(),
          drawSelection(),
          EditorState.allowMultipleSelections.of(true),
          EditorState.readOnly.of(props.readonly),
          rectangularSelection(),
          crosshairCursor(),
          highlightSelectionMatches(),
          headerDecorations(() => excerptsRef.current),
          EditorState.changeFilter.of((transaction) => {
            if (!transaction.docChanged || applyingRef.current) return true;
            if (
              props.readonly ||
              !changesStayInsideExcerpts(transaction.changes, excerptsRef.current)
            )
              return false;
            let writable = true;
            transaction.changes.iterChangedRanges((from) => {
              const excerpt = excerptAt(from, excerptsRef.current, true);
              const buffer =
                excerpt &&
                useCodingWorkspaceStore.getState().projectBuffers[props.rootPath]?.[excerpt.path];
              if (!buffer || buffer.readonly) writable = false;
            });
            return writable;
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || applyingRef.current || props.readonly) return;
            const before = excerptsRef.current;
            applyChangesToBuffers(props.rootPath, update.transactions, before);
            excerptsRef.current = mapExcerpts(before, update.transactions);
          }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          EditorView.domEventHandlers({
            dblclick: (event, view) => {
              const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (position === null) return false;
              const excerpt = excerptAt(position, excerptsRef.current, true);
              if (!excerpt) return false;
              props.onOpenFile(
                excerpt.path,
                basename(excerpt.path),
                sourceLineAt(view.state.doc.toString(), excerpt, position),
              );
              return true;
            },
          }),
        ],
      });
      const view = new EditorView({ state, parent: host });
      viewRef.current = view;
      view.focus();
      return () => {
        view.destroy();
        viewRef.current = null;
      };
      // The editor is updated in place below; recreating it would lose selection and history.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.spec.id, props.rootPath]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view || view.state.doc.toString() === props.document.text) return;
      applyingRef.current = true;
      excerptsRef.current = props.document.excerpts;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: props.document.text },
        annotations: Transaction.addToHistory.of(false),
      });
      applyingRef.current = false;
    }, [props.document]);

    return (
      <div
        ref={hostRef}
        className="code-multibuffer code-theme-editor h-full min-h-0 w-full bg-charcoal-bg"
      />
    );
  }

  function applyChangesToBuffers(
    rootPath: string,
    transactions: readonly Transaction[],
    excerpts: Excerpt[],
  ) {
    const initial = useCodingWorkspaceStore.getState();
    const changed = new Map<string, string>();
    let currentExcerpts = excerpts;
    // Each transaction is expressed against the document after its predecessor.
    for (const transaction of transactions) {
      const byPath = new Map<string, Array<{ from: number; to: number; insert: string }>>();
      transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
        const excerpt = excerptAt(from, currentExcerpts, true);
        if (!excerpt || to > excerpt.virtualTo) return;
        const list = byPath.get(excerpt.path) ?? [];
        list.push({
          from: excerpt.sourceFrom + from - excerpt.virtualFrom,
          to: excerpt.sourceFrom + to - excerpt.virtualFrom,
          insert: inserted.toString(),
        });
        byPath.set(excerpt.path, list);
      });
      for (const [path, edits] of byPath) {
        const buffer = initial.projectBuffers[rootPath]?.[path];
        if (!buffer || buffer.readonly) continue;
        const contents = edits
          .sort((a, b) => b.from - a.from)
          .reduce(
            (text, edit) => text.slice(0, edit.from) + edit.insert + text.slice(edit.to),
            changed.get(path) ?? buffer.contents,
          );
        changed.set(path, contents);
      }
      currentExcerpts = mapOneChangeSet(currentExcerpts, transaction.changes);
    }
    if (changed.size)
      useCodingWorkspaceStore.setState((state) => {
        const buffers = { ...state.projectBuffers[rootPath] };
        for (const [path, contents] of changed) buffers[path] = { ...buffers[path], contents };
        return { projectBuffers: { ...state.projectBuffers, [rootPath]: buffers } };
      });
  }

  function mapExcerpts(excerpts: Excerpt[], transactions: readonly Transaction[]) {
    return transactions.reduce(
      (current, transaction) => mapOneChangeSet(current, transaction.changes),
      excerpts,
    );
  }

  function mapOneChangeSet(excerpts: Excerpt[], changes: ChangeSet) {
    const sourceDeltas = new Map<string, Array<{ at: number; delta: number }>>();
    changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const excerpt = excerptAt(fromA, excerpts, true);
      if (!excerpt) return;
      const at = excerpt.sourceFrom + fromA - excerpt.virtualFrom;
      const list = sourceDeltas.get(excerpt.path) ?? [];
      list.push({ at, delta: inserted.length - (toA - fromA) });
      sourceDeltas.set(excerpt.path, list);
    });
    return excerpts.map((excerpt) => {
      const deltas = sourceDeltas.get(excerpt.path) ?? [];
      const beforeStart = deltas
        .filter((change) => change.at < excerpt.sourceFrom)
        .reduce((sum, change) => sum + change.delta, 0);
      const throughEnd = deltas
        .filter((change) => change.at <= excerpt.sourceTo)
        .reduce((sum, change) => sum + change.delta, 0);
      return {
        ...excerpt,
        sourceFrom: excerpt.sourceFrom + beforeStart,
        sourceTo: excerpt.sourceTo + throughEnd,
        headerFrom: changes.mapPos(excerpt.headerFrom, 1),
        virtualFrom: changes.mapPos(excerpt.virtualFrom, -1),
        virtualTo: changes.mapPos(excerpt.virtualTo, 1),
      };
    });
  }

  function headerDecorations(getExcerpts: () => Excerpt[]) {
    return ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor() {
          this.decorations = this.build();
        }
        update(update: { docChanged: boolean }) {
          if (update.docChanged) this.decorations = this.build();
        }
        build() {
          return Decoration.set(
            getExcerpts().map((excerpt) =>
              Decoration.line({ class: "cm-multibuffer-header" }).range(excerpt.headerFrom),
            ),
            true,
          );
        }
      },
      { decorations: (value) => value.decorations },
    );
  }

  function openSelectedExcerpts(
    view: EditorView,
    excerpts: Excerpt[],
    open: CodeMultibufferProps["onOpenFileInNewTab"],
  ) {
    const selected = new Map<string, { excerpt: Excerpt; position: number }>();
    for (const range of view.state.selection.ranges) {
      const excerpt = excerptAt(range.head, excerpts, true);
      if (excerpt) selected.set(excerpt.path, { excerpt, position: range.head });
    }
    for (const { excerpt, position } of selected.values()) {
      open(
        excerpt.path,
        basename(excerpt.path),
        sourceLineAt(view.state.doc.toString(), excerpt, position),
      );
    }
    return selected.size > 0;
  }

  async function saveExcerptBuffers(rootPath: string, excerpts: Excerpt[]) {
    const store = useCodingWorkspaceStore.getState();
    for (const path of new Set(excerpts.map((excerpt) => excerpt.path))) {
      const buffer = store.projectBuffers[rootPath]?.[path];
      if (!buffer || buffer.readonly || buffer.contents === buffer.savedContents) continue;
      await services.saveFile(rootPath, path, buffer.contents, buffer.lineEnding);
    }
  }

  function excerptAt(position: number, excerpts: Excerpt[], includeEnd = false) {
    return excerpts.find(
      (excerpt) =>
        position >= excerpt.virtualFrom &&
        (includeEnd ? position <= excerpt.virtualTo : position < excerpt.virtualTo),
    );
  }

  function sourceLineAt(document: string, excerpt: Excerpt, position: number) {
    const before = document.slice(excerpt.virtualFrom, Math.max(excerpt.virtualFrom, position));
    return excerpt.startLine + (before.match(/\n/g)?.length ?? 0);
  }

  function emptyMessage(spec: CodeMultibufferSpec) {
    if (spec.kind === "search") return `No matches for “${spec.query}”.`;
    if (spec.kind === "rename" || spec.kind === "code-action")
      return "This change preview expired. Run the action again from its source file.";
    if (spec.kind === "diagnostics") return "No project diagnostics.";
    return "No references found.";
  }

  function ResultMessage(props: { children: React.ReactNode; danger?: boolean }) {
    return (
      <div
        className={`grid h-full place-items-center px-8 text-sm ${props.danger ? "code-danger" : "text-cream-muted"}`}
      >
        {props.children}
      </div>
    );
  }

  function basename(path: string) {
    return path.split("/").filter(Boolean).pop() ?? path;
  }

  return CodeMultibuffer;
}

export function changesStayInsideExcerpts(changes: ChangeSet, excerpts: Excerpt[]) {
  let valid = true;
  changes.iterChangedRanges((fromA, toA) => {
    const excerpt = excerpts.find((item) => fromA >= item.virtualFrom && fromA <= item.virtualTo);
    if (!excerpt || toA > excerpt.virtualTo) valid = false;
  });
  return valid;
}
