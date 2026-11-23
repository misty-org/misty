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
import { errorText } from "../project_api";
import { imageFileUrl, type FileContent } from "../files/files_api";
import { fileName, useFilesStore } from "../files/files_store";
import { editorCommands } from "./editor_commands";
import { useEditorAddons, type EditorAddon, type EditorAppearance } from "./editor_addons";
import { useEditorWordWrap } from "./editor_settings";
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
} from "./editor_search";
import {
  canPreviewFile,
  isHtmlFile,
  isMarkdownFile,
  opensInPreview,
  type EditorViewMode,
} from "./editor_view_mode";
import { useEditorReveal } from "./editor_reveal";
import {
  BASIC_SETUP,
  editorFrameClass,
  IS_MAC,
  LINE_SELECTION,
  PANEL_THEME,
} from "./editor_pane_setup";
import { FileEditorHeader } from "./FileEditorHeader";
import { HtmlPreview } from "./HtmlPreview";
import { MarkdownPreview } from "./MarkdownPreview";

export interface EditorPaneActions {
  close(path: string): void;
  quickOpen(): void;
}

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
  if (!entry?.content) return <EditorSkeleton path={path} />;
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
  const isActiveTab = useFilesStore((state) => state.activeFilePath === path);
  const editorRef = useRef<EditorView | null>(null);

  const name = fileName(path);
  const isMarkdown = isMarkdownFile(name);
  const isHtml = isHtmlFile(name);
  const canPreview = canPreviewFile(name);

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
  const readOnly = content.truncated;

  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchReplace, setSearchReplace] = useState(false);
  const [searchFocus, setSearchFocus] = useState<EditorSearchFocusRequest>({
    target: "find",
    token: 0,
  });
  const searchOpenRef = useRef(false);
  const navigateRef = useRef<((direction: EditorSearchDirection) => void) | null>(null);
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
      clearEditorSearchQuery(view);
      const { selection } = view.state;
      if (selection.ranges.length === 1) {
        view.dispatch({ selection: EditorSelection.single(selection.main.head) });
      }
      if (focusEditor) view.focus();
    }
    return true;
  }, []);
  const closeEditorSearch = useCallback(
    () => closeEditorSearchInternal(true),
    [closeEditorSearchInternal],
  );

  useLayoutEffect(() => {
    if (isActiveTab) return;
    closeEditorSearchInternal(false);
    setPreviewSearchOpen(false);
  }, [isActiveTab, closeEditorSearchInternal]);

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

  useEffect(() => {
    setFileDirty(path, dirty);
    return () => setFileDirty(path, false);
  }, [dirty, path, setFileDirty]);

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
      closeEditorSearch();
      setViewMode(mode);
    },
    [closeEditorSearch],
  );

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
