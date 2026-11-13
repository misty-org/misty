import { useAuth } from "@/features/account";
import { cn, Surface } from "@/shared/ui";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import DragHandle from "@tiptap/extension-drag-handle-react";
import type { JSONContent } from "@tiptap/react";
import { EditorContent, EditorContext, useEditor } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createNoteAiAdapter, updateAiSelection } from "./noteAiAdapter";
import { NoteBlockHandle } from "./NoteBlockHandle";
import { NoteDocumentSkeleton } from "./NoteDocumentSkeleton";
import {
  collectNoteLinks,
  initialContent,
  noteIdFromHref,
  replaceYText,
  watchPendingMarkdown,
} from "./noteEditorContent";
import { createNoteEditorExtensions } from "./noteEditorExtensions";
import { NoteEditorToolbar } from "./NoteEditorToolbar";
import type { NoteAiSelection, NoteBlockEditorProps, NoteEditorSession } from "./noteEditorTypes";
import { findCommands, NoteSearchReplacePanel } from "./NoteSearchReplacePanel";
import { NoteSuggestionMenu, updateSuggestion, type SuggestionState } from "./NoteSuggestionMenu";
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
  const { session, error, notice, lost } = props.runtime.useCollaborationRoom(
    props.spaceId,
    props.noteId,
  );
  if (error) {
    return <>{props.runtime.renderError(error, props.spaceId, props.noteId)}</>;
  }
  // The doc's live copy is still being joined: the editor's own shape stands in.
  if (!session) return <NoteDocumentSkeleton label="Opening doc" toolbar={props.editable} />;
  return (
    <div className="relative h-full">
      {notice ? (
        <Surface
          tone="page"
          edge="hairline"
          radius="md"
          className="sticky top-2 z-20 mx-auto mb-2 max-w-xl px-3 py-2 text-sm shadow-md"
        >
          {notice}
        </Surface>
      ) : null}
      <MistyTipTapEditor
        key={`${props.noteId}:${session.key}`}
        {...props}
        editable={props.editable && session.role !== "viewer" && !lost}
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [replace, setReplace] = useState("");
  const [block, setBlock] = useState<{
    pos: number;
    node: JSONContent;
  } | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null);
  const [aiSelection, setAiSelection] = useState<NoteAiSelection | null>(null);
  // Others see this person's caret under their own name, as in drawings.
  const { user } = useAuth();
  const userName = user?.username || user?.email || "";
  const extensions = useMemo(
    () =>
      createNoteEditorExtensions({
        runtime: props.runtime,
        session: props.session,
        accountId: props.accountId,
        userName,
      }),
    [props.accountId, props.session, props.runtime, userName],
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
        "aria-label": "Doc content",
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
    onCreate: () => {
      loadingRef.current = false;
    },
    onUpdate: ({ editor: updated, transaction }) => {
      updateSuggestion(updated, setSuggestion);
      updateAiSelection(updated, props.aiContext, setAiSelection);
      if (loadingRef.current) return;
      // Only the person who made a change writes it into the markdown copy; every other open copy
      // receives the copy with the change, and writing it again from a stale copy would double it.
      if (isChangeOrigin(transaction)) return;
      if (props.session) {
        replaceYText(props.session.markdown, updated.getMarkdown());
        props.session.metadata.set("schema", "tiptap-v1");
        props.session.metadata.set("outgoing_note_ids", collectNoteLinks(updated));
      }
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
  // An agent's or the API's rewrite reaches the shared content through one editor's copy.
  useEffect(
    () => (editor ? watchPendingMarkdown(editor, props.session) : undefined),
    [editor, props.session],
  );
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
  // The editor mounts on the next render; its frame holds the space without a placeholder.
  if (!editor) return <div className="misty-tiptap-editor" aria-busy="true" />;
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
          <NoteEditorToolbar
            editor={editor}
            searchOpen={searchOpen}
            setSearchOpen={setSearchOpen}
            onAddImage={() => setImagePickerOpen(true)}
          />
        ) : null}
        <NoteSearchReplacePanel
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
        <div className="misty-tiptap-canvas" data-tour="doc-canvas">
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
              <NoteBlockHandle editor={editor} block={block} noteId={props.noteId} />
            </DragHandle>
          ) : null}
          <EditorContent editor={editor} role="presentation" />
          {aiSelection ? props.runtime.renderAiSelection(aiAdapter, aiSelection) : null}
          {suggestion ? (
            <NoteSuggestionMenu
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
