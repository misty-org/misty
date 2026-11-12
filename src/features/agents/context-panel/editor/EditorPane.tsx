// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { closeSearchPanel, openSearchPanel } from "@codemirror/search";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Skeleton } from "@/shared/ui";
import { errorText } from "../projectApi";
import type { FileContent } from "../files/filesApi";
import { fileName, useFilesStore } from "../files/filesStore";
import { BinaryFileView, ImageFileView } from "./EditorFallbackViews";
import {
  EditorSearchPanel,
  type EditorSearchDirection,
  type EditorSearchFocusRequest,
} from "./EditorSearchPanel";
import {
  clearEditorSearchQuery,
  createEditorSearchExtensions,
  type EditorSearchKeymapActions,
} from "./editorSearch";
import {
  canPreviewFile,
  isHtmlFile,
  isMarkdownFile,
  opensInPreview,
  type EditorViewMode,
} from "./editorViewMode";
import { FileEditorHeader } from "./FileEditorHeader";
import { HtmlPreview } from "./HtmlPreview";
import { MarkdownPreview } from "./MarkdownPreview";

const IS_MAC = typeof navigator !== "undefined" && navigator.platform.includes("Mac");
const BASIC_SETUP = { foldGutter: false, highlightActiveLine: true };
/** A click in the line numbers selects the whole line. */
const LINE_SELECTION = lineNumbers({
  domEventHandlers: {
    mousedown(view, block, event) {
      if ((event as MouseEvent).button !== 0) return false;
      const line = view.state.doc.lineAt(block.from);
      const end = line.to < view.state.doc.length ? line.to + 1 : line.to;
      view.focus();
      view.dispatch({ selection: { anchor: line.from, head: end }, userEvent: "select.pointer" });
      return true;
    },
  },
});

const editorSkeleton = (
  <div className="grid gap-2 p-3" aria-hidden="true">
    <Skeleton className="h-4 w-2/3" />
    <Skeleton className="h-4 w-1/2" />
    <Skeleton className="h-4 w-3/5" />
    <Skeleton className="h-4 w-2/5" />
  </div>
);

/** One open file: its text in the code editor, an image, or why it can't be shown. */
export default function EditorPane({ path }: { path: string }) {
  const entry = useFilesStore((state) => state.fileStates[path]);
  const reloadFile = useFilesStore((state) => state.reloadFile);
  const [wordWrap, setWordWrap] = useState(false);
  if (entry?.error) {
    return (
      <div className="editor-error">
        <p>{entry.error}</p>
        <Button size="xs" variant="outline" onClick={() => void reloadFile(path)}>
          Try again
        </Button>
      </div>
    );
  }
  if (!entry || entry.loading || !entry.content) return editorSkeleton;
  // The key gives the editor a fresh draft whenever the file is read again.
  return (
    <FileEditor
      key={`${path}:${entry.loadNonce}`}
      path={path}
      content={entry.content}
      wordWrap={wordWrap}
      onToggleWordWrap={() => setWordWrap((wrap) => !wrap)}
    />
  );
}

function FileEditor({
  path,
  content,
  wordWrap,
  onToggleWordWrap,
}: {
  path: string;
  content: FileContent;
  wordWrap: boolean;
  onToggleWordWrap(): void;
}) {
  const setFileDirty = useFilesStore((state) => state.setFileDirty);
  const saveFile = useFilesStore((state) => state.saveFile);
  // Hidden tabs stay mounted; only the shown one answers ⌘S.
  const isActiveTab = useFilesStore((state) => state.activeFilePath === path);
  const editorRef = useRef<EditorView | null>(null);

  const name = fileName(path);
  const isMarkdown = isMarkdownFile(name);
  const isHtml = isHtmlFile(name);
  const canPreview = canPreviewFile(name);

  const [draft, setDraft] = useState(content.text ?? "");
  const [savedText, setSavedText] = useState(content.text ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<EditorViewMode>(
    canPreview && opensInPreview(name) ? "preview" : "edit",
  );
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const [previewSearchOpen, setPreviewSearchOpen] = useState(false);
  const [languageExtension, setLanguageExtension] = useState<Extension[]>([]);
  // A file too long to read whole is partial: saving it would cut off the rest.
  const readOnly = content.truncated;

  // Find and replace: React draws the card, CodeMirror keeps the search state, the match
  // highlighting and the stepping. Its own panel is a hidden element (editorSearch.ts).
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchReplace, setSearchReplace] = useState(false);
  const [searchFocus, setSearchFocus] = useState<EditorSearchFocusRequest>({
    target: "find",
    token: 0,
  });
  const searchOpenRef = useRef(false);
  const navigateRef = useRef<((direction: EditorSearchDirection) => void) | null>(null);
  const readOnlyRef = useRef(readOnly);
  useEffect(() => {
    readOnlyRef.current = readOnly;
  });

  const openEditorSearch = useCallback((view: EditorView, replace: boolean) => {
    if (replace && readOnlyRef.current) return;
    // Opening CodeMirror's panel state also turns on its match highlighting.
    openSearchPanel(view);
    searchOpenRef.current = true;
    setSearchOpen(true);
    setSearchReplace(replace);
    setSearchFocus((current) => ({
      target: replace ? "replace" : "find",
      token: current.token + 1,
    }));
  }, []);

  const closeEditorSearchInternal = useCallback((focusEditor: boolean) => {
    if (!searchOpenRef.current) return false;
    searchOpenRef.current = false;
    setSearchOpen(false);
    setSearchReplace(false);
    const view = editorRef.current;
    if (view?.dom.isConnected) {
      closeSearchPanel(view);
      // The query goes and one selection collapses to its end, so no highlight outlives the
      // search. Cursors from "Select all matches" stay: closing and then typing edits them.
      clearEditorSearchQuery(view);
      const { selection } = view.state;
      if (selection.ranges.length === 1) {
        view.dispatch({ selection: EditorSelection.single(selection.main.head) });
      }
      // Switching tabs must not pull focus into the now hidden editor.
      if (focusEditor) view.focus();
    }
    return true;
  }, []);
  const closeEditorSearch = useCallback(
    () => closeEditorSearchInternal(true),
    [closeEditorSearchInternal],
  );

  // The find card belongs to the shown tab; it closes when another tab is shown.
  useLayoutEffect(() => {
    if (isActiveTab) return;
    closeEditorSearchInternal(false);
    setPreviewSearchOpen(false);
  }, [isActiveTab, closeEditorSearchInternal]);

  // F3 and ⌘G step through the card, keeping its count current, or open it when closed.
  const stepEditorSearch = useCallback(
    (view: EditorView, direction: EditorSearchDirection) => {
      if (!searchOpenRef.current) {
        openEditorSearch(view, false);
        return true;
      }
      navigateRef.current?.(direction);
      return true;
    },
    [openEditorSearch],
  );

  // A stable source for CodeMirror's keymap, built once yet always calling the latest callbacks.
  const searchActionsRef = useRef<EditorSearchKeymapActions>({
    openFind: (view) => {
      openEditorSearch(view, false);
      return true;
    },
    openReplace: (view) => {
      if (readOnlyRef.current) return true;
      openEditorSearch(view, true);
      return true;
    },
    findNext: (view) => stepEditorSearch(view, "next"),
    findPrevious: (view) => stepEditorSearch(view, "prev"),
    close: () => closeEditorSearch(),
  });

  const dirty = !readOnly && draft !== savedText;
  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const committed = await saveFile(path, draft);
      setSavedText(committed);
    } catch (error) {
      setSaveError(errorText(error));
    } finally {
      setSaving(false);
    }
  }, [path, draft, saveFile]);
  const saveRef = useRef(save);
  const dirtyRef = useRef(dirty);
  const savingRef = useRef(saving);
  useEffect(() => {
    saveRef.current = save;
    dirtyRef.current = dirty;
    savingRef.current = saving;
  });

  const searchExtensions = useMemo(
    () => createEditorSearchExtensions(searchActionsRef, IS_MAC),
    [],
  );
  // ⌘S saves from inside the editor.
  const saveKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            if (dirtyRef.current && !savingRef.current) void saveRef.current();
            return true;
          },
        },
      ]),
    [],
  );
  const extensions = useMemo(
    () => [
      LINE_SELECTION,
      saveKeymap,
      ...languageExtension,
      ...searchExtensions,
      ...(wordWrap ? [EditorView.lineWrapping] : []),
    ],
    [languageExtension, wordWrap, searchExtensions, saveKeymap],
  );

  // The tab strip marks a tab with unsaved edits and asks before closing it.
  useEffect(() => {
    setFileDirty(path, dirty);
    return () => setFileDirty(path, false);
  }, [dirty, path, setFileDirty]);

  // ⌘S also works while focus is elsewhere in the panel, for the shown tab only.
  useEffect(() => {
    if (readOnly || !isActiveTab) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = IS_MAC ? event.metaKey : event.ctrlKey;
      if (!mod || event.altKey || event.shiftKey || event.key.toLowerCase() !== "s") return;
      if (editorRef.current?.hasFocus) return;
      event.preventDefault();
      if (dirtyRef.current && !savingRef.current) void saveRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [readOnly, isActiveTab]);

  // ⌘F opens the Markdown preview's find bar while that preview shows.
  useEffect(() => {
    if (!isActiveTab || !isMarkdown || viewMode !== "preview") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = IS_MAC ? event.metaKey : event.ctrlKey;
      if (!mod || event.altKey || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      setPreviewSearchOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isActiveTab, isMarkdown, viewMode]);

  const changeViewMode = useCallback(
    (mode: EditorViewMode) => {
      setPreviewSearchOpen(false);
      // Closed before CodeMirror's view goes, or its panel state would be dropped unclosed.
      closeEditorSearch();
      setViewMode(mode);
    },
    [closeEditorSearch],
  );

  // The language comes from the file's name, loaded on demand.
  useEffect(() => {
    let cancelled = false;
    setLanguageExtension([]);
    const described = LanguageDescription.matchFilename(languages, name);
    if (!described) return;
    void described
      .load()
      .then((support) => !cancelled && setLanguageExtension([support]))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [name]);

  useEffect(
    () => () => {
      editorRef.current = null;
    },
    [],
  );

  if (content.kind === "image") return <ImageFileView name={name} dataUrl={content.dataUrl} />;
  if (content.kind === "binary") return <BinaryFileView name={name} />;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <FileEditorHeader
        path={path}
        name={name}
        dirty={dirty}
        readOnly={readOnly}
        canPreview={canPreview}
        isMarkdown={isMarkdown}
        isHtml={isHtml}
        viewMode={viewMode}
        onViewModeChange={changeViewMode}
        onReloadPreview={() => setPreviewReloadKey((key) => key + 1)}
        saving={saving}
        onSave={() => void save()}
        searchOpen={previewSearchOpen}
        onToggleSearch={() => setPreviewSearchOpen((open) => !open)}
        wordWrap={wordWrap}
        onToggleWordWrap={onToggleWordWrap}
      />
      {saveError ? (
        <p className="editor-save-error" role="alert">
          {saveError}
        </p>
      ) : null}
      {canPreview && viewMode === "preview" ? (
        isMarkdown ? (
          <MarkdownPreview
            path={path}
            draft={draft}
            active={isActiveTab}
            searchOpen={previewSearchOpen}
            onSearchOpenChange={setPreviewSearchOpen}
          />
        ) : (
          <HtmlPreview path={path} name={name} reloadKey={previewReloadKey} active={isActiveTab} />
        )
      ) : (
        <div className="context-editor relative flex min-h-0 min-w-0 flex-1">
          <CodeMirror
            className="min-h-0 flex-1 overflow-hidden"
            height="100%"
            value={draft}
            theme="dark"
            onCreateEditor={(view) => {
              editorRef.current = view;
              setEditorView(view);
            }}
            onChange={setDraft}
            extensions={extensions}
            readOnly={readOnly}
            basicSetup={BASIC_SETUP}
          />
          <EditorSearchPanel
            view={editorView}
            open={searchOpen}
            showReplace={searchReplace}
            readOnly={readOnly}
            isMac={IS_MAC}
            focusRequest={searchFocus}
            documentText={draft}
            onShowReplaceChange={setSearchReplace}
            onClose={closeEditorSearch}
            navigateRef={navigateRef}
          />
        </div>
      )}
    </div>
  );
}
