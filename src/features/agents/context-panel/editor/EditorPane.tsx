// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { closeSearchPanel, openSearchPanel } from "@codemirror/search";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Text } from "@misty/ui";
import { EditorSkeleton } from "../PanelSkeletons";
import { errorText } from "../projectApi";
import { imageFileUrl, type FileContent } from "../files/filesApi";
import { fileName, useFilesStore } from "../files/filesStore";
import { editorCommands } from "./editorCommands";
import { useEditorAddons, type EditorAddon, type EditorAppearance } from "./editorAddons";
import { useEditorWordWrap } from "./editorSettings";
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
import { useEditorReveal } from "./editorReveal";
import {
  BASIC_SETUP,
  editorFrameClass,
  IS_MAC,
  LINE_SELECTION,
  PANEL_THEME,
} from "./editorPaneSetup";
import { FileEditorHeader } from "./FileEditorHeader";
import { HtmlPreview } from "./HtmlPreview";
import { MarkdownPreview } from "./MarkdownPreview";

/** What the pane holding an editor offers it: closing its tab and quick open (vim's `:q`, `:e`). */
export interface EditorPaneActions {
  close(path: string): void;
  quickOpen(): void;
}

/**
 * One open file: its text in the code editor, an image, or why it can't be shown. `appearance`
 * says where it is shown: the chat's floating panel, or the Code page, which brings its own theme,
 * language servers and live sessions (`code/useEditorAddons.ts`).
 */
export default function EditorPane({
  path,
  appearance = "panel",
  actions,
}: {
  path: string;
  appearance?: EditorAppearance;
  actions?: EditorPaneActions;
}) {
  const entry = useFilesStore((state) => state.fileStates[path]);
  const root = useFilesStore((state) => state.root);
  const reloadFile = useFilesStore((state) => state.reloadFile);
  // Wrapping is the editor's, not this file's: toggled here, it stays for every file and in Settings.
  const wordWrap = useEditorWordWrap((state) => state.value);
  const setWordWrap = useEditorWordWrap((state) => state.set);
  const diskText = entry?.content?.kind === "text" ? (entry.content.text ?? "") : "";
  const addon = useEditorAddons({ path, root, appearance, diskText });
  if (entry?.error) {
    return (
      <Text
        bare
        as="div"
        size="meta"
        tone="muted"
        className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center break-all"
      >
        <p>{entry.error}</p>
        <Button size="sm" variant="secondary" onClick={() => void reloadFile(path)}>
          Try again
        </Button>
      </Text>
    );
  }
  // A file read again keeps its text on screen until the new one arrives.
  if (!entry?.content) return <EditorSkeleton path={path} />;
  // The key gives the editor a fresh draft whenever the file is read again, or an add-on (a live
  // session) starts it from another text.
  return (
    <FileEditor
      key={`${path}:${entry.loadNonce}:${addon.document?.key ?? ""}`}
      path={path}
      content={entry.content}
      appearance={appearance}
      addon={addon}
      actions={actions}
      wordWrap={wordWrap}
      onToggleWordWrap={() => setWordWrap((wrap) => !wrap)}
    />
  );
}

function FileEditor({
  path,
  content,
  appearance,
  addon,
  actions,
  wordWrap,
  onToggleWordWrap,
}: {
  path: string;
  content: FileContent;
  appearance: EditorAppearance;
  addon: EditorAddon;
  actions?: EditorPaneActions;
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

  // A live session's shared text, when it has one, stands in for the file as read.
  const startText = addon.document?.text ?? content.text ?? "";
  const [draft, setDraft] = useState(startText);
  const [savedText, setSavedText] = useState(startText);
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
  // A search result asked for a line of this file: put the cursor there and show it.
  const revealTarget = useEditorReveal((state) => state.target);
  useEffect(() => {
    if (!editorView || !revealTarget || revealTarget.path !== path) return;
    const doc = editorView.state.doc;
    const line = doc.line(Math.min(Math.max(1, revealTarget.line), doc.lines));
    editorView.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    editorView.focus();
    useEditorReveal.getState().clear();
  }, [editorView, revealTarget, path]);
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

  // A live session writes the file itself, so there is never anything left to save.
  const savesItself = Boolean(addon.savesItself);
  const dirty = !readOnly && !savesItself && draft !== savedText;
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
  const actionsRef = useRef(actions);
  useEffect(() => {
    saveRef.current = save;
    dirtyRef.current = dirty;
    savingRef.current = saving;
    actionsRef.current = actions;
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
  // What vim's `:w`, `:q` and `:e` do here, always calling the latest save and the pane's actions.
  const commands = useMemo(
    () =>
      editorCommands.of({
        save: () => {
          if (dirtyRef.current && !savingRef.current) void saveRef.current();
        },
        close: () => actionsRef.current?.close(path),
        quickOpen: () => actionsRef.current?.quickOpen(),
      }),
    [path],
  );
  const extensions = useMemo(
    () => [
      ...(appearance === "panel" ? [PANEL_THEME] : []),
      LINE_SELECTION,
      saveKeymap,
      commands,
      ...languageExtension,
      ...searchExtensions,
      ...(wordWrap ? [EditorView.lineWrapping] : []),
      ...addon.extensions,
    ],
    [
      appearance,
      languageExtension,
      wordWrap,
      searchExtensions,
      saveKeymap,
      commands,
      addon.extensions,
    ],
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

  if (content.kind === "image") {
    return (
      <ImageFileView name={name} src={imageFileUrl(path, content.mtimeMs)} size={content.size} />
    );
  }
  if (content.kind === "binary") return <BinaryFileView name={name} />;

  return (
    // Clipped so the editor keeping its cursor in view never scrolls the pane around it.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-clip">
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
        appearance={appearance}
      />
      {saveError ? (
        <Text
          wrap
          size="caption"
          tone="removed"
          className="border-b px-3 py-2 break-all"
          role="alert"
        >
          {saveError}
        </Text>
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
        <>
          {/* Find docks over the code, the same bar every document uses. */}
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
          {/* In the chat's floating panel the code sits on the panel's own fill. */}
          <div className={editorFrameClass}>
            <CodeMirror
              className="min-h-0 flex-1 overflow-hidden"
              height="100%"
              value={draft}
              theme={appearance === "page" ? "none" : "dark"}
              onCreateEditor={(view) => {
                editorRef.current = view;
                setEditorView(view);
              }}
              onChange={setDraft}
              extensions={extensions}
              readOnly={readOnly}
              basicSetup={BASIC_SETUP}
            />
          </div>
        </>
      )}
    </div>
  );
}
