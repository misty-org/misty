import { cn } from "@/shared/ui";
import DragHandle from "@tiptap/extension-drag-handle-react";
import type { JSONContent } from "@tiptap/react";
import { EditorContent, EditorContext, useEditor } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createNoteAiAdapter, updateAiSelection } from "./noteAiAdapter";
import { BlockHandle } from "./NoteBlockHandle";
import {
  applyPendingMarkdown,
  collectNoteLinks,
  initialContent,
  noteIdFromHref,
  replaceYText,
} from "./noteEditorContent";
import { createNoteEditorExtensions } from "./noteEditorExtensions";
import { SimpleEditorToolbar } from "./NoteEditorToolbar";
import type { NoteAiSelection, NoteBlockEditorProps, NoteEditorSession } from "./noteEditorTypes";
import { findCommands, SearchReplacePanel } from "./NoteSearchReplacePanel";
import { SuggestionMenu, updateSuggestion, type SuggestionState } from "./NoteSuggestionMenu";
import "./noteTiptapEditor.css";

export type {
  NoteAiSelection,
  NoteBlockEditorProps,
  NoteEditorRuntime,
  NoteEditorSession,
} from "./noteEditorTypes";
export { noteSelectionActions } from "./noteAiAdapter";

export function NoteBlockEditorView(props: NoteBlockEditorProps) {
  if (props.collaborative && props.spaceId) {
    return <CollaborativeNoteEditor {...props} spaceId={props.spaceId} />;
  }
  return <MistyTipTapEditor {...props} />;
}
function CollaborativeNoteEditor(
  props: NoteBlockEditorProps & {
    spaceId: string;
  },
) {
  const { session, error, notice } = props.runtime.useCollaborationRoom(
    props.spaceId,
    props.noteId,
  );
  if (error) {
    return (
      <>
        {props.runtime.renderError(error, props.spaceId, props.noteId)}
        <div className="rounded-md border border-charcoal-border bg-charcoal-card px-4 py-3 text-sm text-cream-muted">
          The note connection could not be opened.
        </div>
      </>
    );
  }
  if (!session) return <div className="px-2 py-3 text-sm text-cream-muted">Connecting note…</div>;
  return (
    <div className="relative h-full">
      {notice ? (
        <div className="sticky top-2 z-20 mx-auto mb-2 max-w-xl rounded-md border border-sage-fg/30 bg-charcoal-bg px-3 py-2 text-sm shadow-md">
          {notice}
        </div>
      ) : null}
      <MistyTipTapEditor
        key={`${props.noteId}:${session.key}`}
        {...props}
        editable={props.editable && session.role !== "viewer"}
        session={session}
      />
    </div>
  );
}
function MistyTipTapEditor(
  props: NoteBlockEditorProps & {
    session?: NoteEditorSession;
  },
) {
  const { body, bodyFormat, bodyMarkdown, session } = props;
  const loadingRef = useRef(true);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const onContentChangeRef = useRef(props.onContentChange);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [replace, setReplace] = useState("");
  const [block, setBlock] = useState<{
    pos: number;
    node: JSONContent;
  } | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null);
  const [aiSelection, setAiSelection] = useState<NoteAiSelection | null>(null);
  useEffect(() => {
    onContentChangeRef.current = props.onContentChange;
  }, [props.onContentChange]);
  const extensions = useMemo(
    () =>
      createNoteEditorExtensions({
        runtime: props.runtime,
        session: props.session,
        accountId: props.accountId,
      }),
    [props.accountId, props.session, props.runtime],
  );
  const editor = useEditor({
    immediatelyRender: false,
    editable: props.editable,
    extensions,
    content: props.session ? undefined : initialContent(props),
    contentType: props.session || props.bodyFormat === "tiptap-json" ? "json" : "markdown",
    editorProps: {
      attributes: {
        autocomplete: "off",
        autocorrect: "on",
        autocapitalize: "sentences",
        spellcheck: "true",
        "aria-label": "Note content",
        class: "misty-tiptap-prosemirror",
        "data-misty-window-drag-block": "true",
      },
      handleClick: (_view, _pos, event) => {
        const anchor = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[href]");
        if (!anchor) return false;
        const linkedNote = noteIdFromHref(anchor.getAttribute("href") ?? "");
        if (!linkedNote) return false;
        event.preventDefault();
        props.onOpenNote?.(linkedNote);
        return true;
      },
    },
    onCreate: ({ editor: created }) => {
      loadingRef.current = false;
      applyPendingMarkdown(created, props.session);
    },
    onUpdate: ({ editor: updated }) => {
      updateSuggestion(updated, setSuggestion);
      updateAiSelection(updated, props.aiContext, setAiSelection);
      if (loadingRef.current) return;
      const markdown = updated.getMarkdown();
      const body = JSON.stringify(updated.getJSON());
      if (props.session) {
        replaceYText(props.session.markdown, markdown);
        props.session.metadata.set("schema", "tiptap-v1");
        props.session.metadata.set("outgoing_note_ids", collectNoteLinks(updated));
      }
      onContentChangeRef.current?.({
        body,
        bodyFormat: "tiptap-json",
        bodyMarkdown: markdown,
      });
    },
    onSelectionUpdate: ({ editor: updated }) => {
      updateSuggestion(updated, setSuggestion);
      updateAiSelection(updated, props.aiContext, setAiSelection);
    },
  });
  useEffect(() => editor?.setEditable(props.editable), [editor, props.editable]);
  useEffect(() => {
    if (!editor || session || loadingRef.current) return;
    editor.commands.setContent(
      initialContent({
        body,
        bodyFormat,
        bodyMarkdown,
      }),
      {
        contentType: bodyFormat === "tiptap-json" ? "json" : "markdown",
        emitUpdate: false,
      },
    );
  }, [body, bodyFormat, bodyMarkdown, editor, session]);
  useEffect(() => {
    if (!editor || !props.editable || !props.autoFocus) return;
    const frame = requestAnimationFrame(() => editor.commands.focus("end"));
    return () => cancelAnimationFrame(frame);
  }, [editor, props.autoFocus, props.editable]);
  useEffect(() => {
    if (!editor || !props.session) return;
    const apply = () => applyPendingMarkdown(editor, props.session);
    props.session.metadata.observe(apply);
    props.session.provider.awareness.on("change", apply);
    apply();
    return () => {
      props.session?.metadata.unobserve(apply);
      props.session?.provider.awareness.off("change", apply);
    };
  }, [editor, props.session]);
  useEffect(() => {
    if (!editor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    editor.view.dom.addEventListener("keydown", onKeyDown);
    return () => editor.view.dom.removeEventListener("keydown", onKeyDown);
  }, [editor]);
  if (!editor) return <div className="px-2 py-3 text-sm text-cream-muted">Opening editor…</div>;
  const aiAdapter = createNoteAiAdapter(editor, props, aiSelection);
  const uploadImage = async (file?: File) => {
    if (!file) return;
    const src = await props.runtime.uploadAsset({
      accountId: props.accountId,
      spaceId: props.spaceId,
      noteId: props.noteId,
      file,
    });
    editor
      .chain()
      .focus()
      .setImage({
        src,
        alt: file.name,
      })
      .run();
  };
  return (
    <EditorContext.Provider
      value={{
        editor,
      }}
    >
      <div className={cn("misty-tiptap-editor", !props.editable && "is-readonly")}>
        {props.runtime.renderAiRegistration(aiAdapter)}
        {props.editable ? (
          <SimpleEditorToolbar
            editor={editor}
            searchOpen={searchOpen}
            setSearchOpen={setSearchOpen}
            onAddImage={() => setImagePickerOpen(true)}
          />
        ) : null}
        <SearchReplacePanel
          editor={editor}
          open={searchOpen}
          search={search}
          replace={replace}
          onSearchChange={(value) => {
            setSearch(value);
            findCommands(editor).setSearchTerm(value);
          }}
          onReplaceChange={(value) => {
            setReplace(value);
            findCommands(editor).setReplaceTerm(value);
          }}
          onClose={() => {
            setSearchOpen(false);
            findCommands(editor).setSearchTerm("");
          }}
        />
        <div className="misty-tiptap-canvas">
          {props.editable ? (
            <DragHandle
              editor={editor}
              nested
              computePositionConfig={{
                placement: "left-start",
                strategy: "fixed",
              }}
              onNodeChange={({ node, pos }) =>
                setBlock(
                  node && typeof pos === "number"
                    ? {
                        pos,
                        node: node.toJSON(),
                      }
                    : null,
                )
              }
            >
              <BlockHandle editor={editor} block={block} noteId={props.noteId} />
            </DragHandle>
          ) : null}
          <EditorContent editor={editor} role="presentation" />
          {aiSelection ? props.runtime.renderAiSelection(aiAdapter, aiSelection) : null}
          {suggestion ? (
            <SuggestionMenu
              editor={editor}
              suggestion={suggestion}
              notes={props.linkableNotes ?? []}
              onClose={() => setSuggestion(null)}
            />
          ) : null}
        </div>
        {imagePickerOpen
          ? props.runtime.renderImagePicker({
              onCancel: () => setImagePickerOpen(false),
              onSelect: (file) => {
                setImagePickerOpen(false);
                void uploadImage(file).catch(props.runtime.reportError);
              },
            })
          : null}
      </div>
    </EditorContext.Provider>
  );
}
