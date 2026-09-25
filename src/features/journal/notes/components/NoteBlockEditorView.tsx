import "./noteTiptapEditor.css";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Separator,
  cn,
} from "@/shared/ui";
import type {
  AiArtifact,
  AiContextReference,
  AiSelectionSnapshot,
  AiSuggestedAction,
  AiSurfaceAdapter,
} from "@/features/ai-surface/types";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import DragHandle from "@tiptap/extension-drag-handle-react";
import { FindAndReplace } from "@tiptap/extension-find-and-replace";
import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { journalImage } from "./journalImage";
import type { JournalImageLease } from "@/features/journal/sdkJournalAssets";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TextAlign } from "@tiptap/extension-text-align";
import { Typography } from "@tiptap/extension-typography";
import { UniqueID } from "@tiptap/extension-unique-id";
import { Markdown } from "@tiptap/markdown";
import type { Editor, JSONContent } from "@tiptap/react";
import { EditorContent, EditorContext, useEditor } from "@tiptap/react";
import type { Text as YText } from "yjs";
import { StarterKit } from "@tiptap/starter-kit";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Braces,
  Copy,
  GripVertical,
  Heading,
  Highlighter,
  ImagePlus,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Plus,
  Quote,
  Search,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { NoteBodyFormat } from "../model/types/types";
import type { UploadNoteAssetInput } from "../noteAssets";
import type { NoteCollaborationSession } from "../noteCollaboration";
import {
  NoteToolbarInlineControls,
  NoteToolbarStructureControls,
} from "./NoteEditorToolbarControls";

export type NoteEditorSession = Pick<
  NoteCollaborationSession,
  "key" | "doc" | "fragment" | "title" | "markdown" | "metadata"
> & {
  role: "creator" | "editor" | "viewer";
  provider: Pick<NoteCollaborationSession["provider"], "awareness" | "on" | "off" | "synced">;
};
export interface NoteEditorRuntime {
  useCollaborationRoom(
    spaceId: string,
    noteId: string,
  ): { session: NoteEditorSession | null; error: string | null; notice: string | null };
  uploadAsset(input: UploadNoteAssetInput): Promise<string>;
  resolveAsset?(reference: string): Promise<JournalImageLease>;
  renderImagePicker(input: { onCancel(): void; onSelect(file: File): void }): ReactNode;
  renderAiRegistration(adapter: AiSurfaceAdapter | null): ReactNode;
  renderAiSelection(adapter: AiSurfaceAdapter | null, selection: NoteAiSelection): ReactNode;
  renderError(error: string, spaceId: string, noteId: string): ReactNode;
  reportError(error: unknown): void;
  openCitation(citation: Parameters<NonNullable<AiSurfaceAdapter["openCitation"]>>[0]): void;
}

export interface NoteBlockEditorProps {
  runtime: NoteEditorRuntime;
  editable: boolean;
  collaborative?: boolean;
  noteId: string;
  accountId?: string;
  spaceId?: string;
  body: string;
  bodyFormat: NoteBodyFormat;
  bodyMarkdown?: string;
  autoFocus?: boolean;
  linkableNotes?: Array<{ id: string; title: string }>;
  onOpenNote?: (noteId: string) => void;
  aiContext?: AiContextReference;
  onContentChange?: (content: {
    body: string;
    bodyFormat: "tiptap-json";
    bodyMarkdown: string;
  }) => void;
}

/**
 * Based on Tiptap's MIT-licensed Simple Editor template. Its toolbar groups
 * and responsive horizontal overflow intentionally follow the upstream code.
 * https://tiptap.dev/docs/ui-components/templates/simple-editor
 */
export function NoteBlockEditorView(props: NoteBlockEditorProps) {
  if (props.collaborative && props.spaceId) {
    return <CollaborativeNoteEditor {...props} spaceId={props.spaceId} />;
  }
  return <MistyTipTapEditor {...props} />;
}

function CollaborativeNoteEditor(props: NoteBlockEditorProps & { spaceId: string }) {
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

function MistyTipTapEditor(props: NoteBlockEditorProps & { session?: NoteEditorSession }) {
  const { body, bodyFormat, bodyMarkdown, session } = props;
  const loadingRef = useRef(true);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const onContentChangeRef = useRef(props.onContentChange);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [replace, setReplace] = useState("");
  const [block, setBlock] = useState<{ pos: number; node: JSONContent } | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null);
  const [aiSelection, setAiSelection] = useState<NoteAiSelection | null>(null);

  useEffect(() => {
    onContentChangeRef.current = props.onContentChange;
  }, [props.onContentChange]);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        undoRedo: props.session ? false : undefined,
        link: { openOnClick: false, enableClickSelection: true },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      props.runtime.resolveAsset
        ? journalImage(props.runtime.resolveAsset)
        : Image.configure({ allowBase64: false }),
      Typography,
      Superscript,
      Subscript,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      UniqueID.configure({
        types: [
          "paragraph",
          "heading",
          "blockquote",
          "codeBlock",
          "bulletList",
          "orderedList",
          "taskList",
          "image",
        ],
      }),
      FindAndReplace.configure({ searchDebounceMs: 250, injectCSS: false }),
      Markdown.configure({ markedOptions: { gfm: true } }),
      ...(props.session
        ? [
            Collaboration.configure({ fragment: props.session.fragment }),
            CollaborationCaret.configure({
              provider: props.session.provider as never,
              user: collaborationUser(props.accountId),
            }),
          ]
        : []),
    ],
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
      onContentChangeRef.current?.({ body, bodyFormat: "tiptap-json", bodyMarkdown: markdown });
    },
    onSelectionUpdate: ({ editor: updated }) => {
      updateSuggestion(updated, setSuggestion);
      updateAiSelection(updated, props.aiContext, setAiSelection);
    },
  });

  useEffect(() => editor?.setEditable(props.editable), [editor, props.editable]);
  useEffect(() => {
    if (!editor || session || loadingRef.current) return;
    editor.commands.setContent(initialContent({ body, bodyFormat, bodyMarkdown }), {
      contentType: bodyFormat === "tiptap-json" ? "json" : "markdown",
      emitUpdate: false,
    });
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
    editor.chain().focus().setImage({ src, alt: file.name }).run();
  };

  return (
    <EditorContext.Provider value={{ editor }}>
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
              computePositionConfig={{ placement: "left-start", strategy: "fixed" }}
              onNodeChange={({ node, pos }) =>
                setBlock(node && typeof pos === "number" ? { pos, node: node.toJSON() } : null)
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

export type NoteAiSelection = {
  snapshot: AiSelectionSnapshot;
  from: number;
  to: number;
  x: number;
  y: number;
};

export interface NotesInlineProposal {
  selection: AiSelectionSnapshot;
  replacement: string;
  artifactId: string;
  invocationId?: string;
  status: "proposed" | "stale" | "applying" | "applied" | "discarded" | "failed";
}

export const noteSelectionActions: AiSuggestedAction[] = [
  {
    id: "notes.improve",
    label: "Improve writing",
    prompt: "Improve this writing while preserving its meaning and voice.",
    trigger: "selection",
    requestedArtifactKind: "text_patch",
  },
  {
    id: "notes.shorten",
    label: "Make concise",
    prompt: "Make this text clearer and more concise without losing important details.",
    trigger: "selection",
    requestedArtifactKind: "text_patch",
  },
  {
    id: "notes.clarify",
    label: "Clarify",
    prompt: "Rewrite this text so it is easier to understand and preserves the original intent.",
    trigger: "selection",
    requestedArtifactKind: "text_patch",
  },
  {
    id: "notes.summarize-selection",
    label: "Summarize",
    prompt: "Summarize the selected text and call out its most important point.",
    trigger: "selection",
  },
  {
    id: "notes.extract-tasks-selection",
    label: "Extract tasks",
    prompt: "Extract only concrete action items from this selection as reviewable tasks.",
    trigger: "selection",
    requestedArtifactKind: "task_set",
  },
];

const notePageActions: AiSuggestedAction[] = [
  {
    id: "notes.summarize",
    label: "Summarize note",
    prompt: "Summarize this note, including its key points and any unresolved questions.",
    trigger: "object",
  },
  {
    id: "notes.decisions",
    label: "Find decisions",
    prompt: "Identify decisions, commitments, and open questions in this note.",
    trigger: "object",
  },
  {
    id: "notes.next-steps",
    label: "Find next steps",
    prompt: "Identify concrete next steps in this note. Do not create anything yet.",
    trigger: "object",
  },
  {
    id: "notes.extract-tasks",
    label: "Extract tasks",
    prompt: "Extract concrete action items from this note as reviewable tasks.",
    trigger: "object",
    requestedArtifactKind: "task_set",
  },
];

function createNoteAiAdapter(
  editor: Editor,
  props: NoteBlockEditorProps & { session?: NoteEditorSession },
  selection: NoteAiSelection | null,
): AiSurfaceAdapter | null {
  const context = props.aiContext;
  if (!context) return null;
  return {
    surfaceId: "notes",
    label: context.title || "this note",
    getContext: () => [context],
    getSelection: () => selection?.snapshot ?? null,
    getSuggestedActions: () => (selection ? noteSelectionActions : notePageActions),
    canApply: (artifact) => canApplyNoteArtifact(editor, props, artifact),
    applyArtifact: (artifact) => applyNoteArtifact(editor, props, artifact),
    undoArtifact: () => {
      editor.chain().focus().undo().run();
    },
    openCitation: (citation) => {
      const noteId = citation.kind === "note" ? noteIdFromHref(citation.href) : null;
      if (noteId) props.onOpenNote?.(noteId);
      else if (citation.href) {
        props.runtime.openCitation(citation);
      }
    },
  };
}

function updateAiSelection(
  editor: Editor,
  context: AiContextReference | undefined,
  setSelection: (selection: NoteAiSelection | null) => void,
) {
  if (!context) return setSelection(null);
  const { from, to, empty } = editor.state.selection;
  if (empty || from === to) return setSelection(null);
  const content = editor.state.doc.textBetween(from, to, "\n", "\n");
  if (!content.trim()) return setSelection(null);
  const start = editor.view.coordsAtPos(from);
  const end = editor.view.coordsAtPos(to);
  setSelection({
    from,
    to,
    x: Math.max(12, Math.min(start.left, end.left)),
    y: Math.max(12, Math.min(start.top, end.top) - 38),
    snapshot: {
      kind: "text",
      content,
      object: {
        kind: context.kind,
        id: context.id,
        spaceId: context.spaceId,
        revision: context.revision,
      },
      anchors: { from, to, editor: "tiptap-prosemirror-v1" },
      contentHash: noteSelectionHash(content),
    },
  });
}

function canApplyNoteArtifact(editor: Editor, props: NoteBlockEditorProps, artifact: AiArtifact) {
  if (!props.editable || artifact.kind !== "text_patch" || !props.aiContext) return false;
  if (artifact.target?.id !== props.aiContext.id) return false;
  if (
    artifact.baseRevision != null &&
    props.aiContext.revision != null &&
    String(artifact.baseRevision) !== String(props.aiContext.revision)
  ) {
    return false;
  }
  const selection = artifactSelection(artifact);
  if (!selection) return false;
  return noteSelectionAt(editor, selection) === selection.content;
}

async function applyNoteArtifact(
  editor: Editor,
  props: NoteBlockEditorProps,
  artifact: AiArtifact,
) {
  if (!canApplyNoteArtifact(editor, props, artifact)) {
    throw new Error("The note selection changed. Ask Misty to regenerate this draft.");
  }
  const operations = artifact.operations as Record<string, unknown>;
  const replacement = operations.replacement;
  const selection = artifactSelection(artifact);
  if (typeof replacement !== "string" || !selection) {
    throw new Error("This note draft is not compatible with the current editor.");
  }
  const from = Number(selection.anchors?.from);
  const to = Number(selection.anchors?.to);
  editor.view.dispatch(editor.state.tr.insertText(replacement, from, to));
  editor.commands.focus(Math.min(from + replacement.length, editor.state.doc.content.size));
}

function artifactSelection(artifact: AiArtifact): AiSelectionSnapshot | null {
  const value = (artifact.operations as Record<string, unknown>)?.selection;
  if (!value || typeof value !== "object") return null;
  const selection = value as AiSelectionSnapshot;
  const from = Number(selection.anchors?.from);
  const to = Number(selection.anchors?.to);
  return Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from
    ? selection
    : null;
}

function noteSelectionAt(editor: Editor, selection: AiSelectionSnapshot) {
  const from = Number(selection.anchors?.from);
  const to = Number(selection.anchors?.to);
  if (to > editor.state.doc.content.size) return null;
  const current = editor.state.doc.textBetween(from, to, "\n", "\n");
  return noteSelectionHash(current) === selection.contentHash ? current : null;
}

function noteSelectionHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function SimpleEditorToolbar(props: {
  editor: Editor;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  onAddImage: () => void;
}) {
  const { editor } = props;
  return (
    <div className="misty-tiptap-toolbar" role="toolbar" aria-label="Text formatting">
      <NoteToolbarStructureControls editor={editor} />
      <ToolbarRule />
      <ToolbarRule />
      <NoteToolbarInlineControls editor={editor} />
      <ToolbarRule />
      <ToolbarGroup>
        <ToolButton
          label="Superscript"
          Icon={SuperscriptIcon}
          active={editor.isActive("superscript")}
          onClick={() => editor.chain().focus().toggleSuperscript().run()}
        />
        <ToolButton
          label="Subscript"
          Icon={SubscriptIcon}
          active={editor.isActive("subscript")}
          onClick={() => editor.chain().focus().toggleSubscript().run()}
        />
      </ToolbarGroup>
      <ToolbarRule />
      <ToolbarGroup>
        <ToolButton
          label="Align left"
          Icon={AlignLeft}
          active={editor.isActive({ textAlign: "left" })}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        />
        <ToolButton
          label="Align center"
          Icon={AlignCenter}
          active={editor.isActive({ textAlign: "center" })}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        />
        <ToolButton
          label="Align right"
          Icon={AlignRight}
          active={editor.isActive({ textAlign: "right" })}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
        />
        <ToolButton
          label="Justify"
          Icon={AlignJustify}
          active={editor.isActive({ textAlign: "justify" })}
          onClick={() => editor.chain().focus().setTextAlign("justify").run()}
        />
      </ToolbarGroup>
      <ToolbarRule />
      <ToolbarGroup>
        <Button
          variant="ghost"
          size="sm"
          className="misty-tiptap-tool gap-1.5 px-2"
          onClick={props.onAddImage}
        >
          <ImagePlus size={17} />
          Add
        </Button>
      </ToolbarGroup>
      <div className="min-w-2 flex-1" />
      <ToolbarGroup>
        <ToolButton
          label="Search and replace"
          Icon={Search}
          active={props.searchOpen}
          onClick={() => props.setSearchOpen(!props.searchOpen)}
        />
      </ToolbarGroup>
    </div>
  );
}

function ToolbarGroup({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center gap-0.5">{children}</div>;
}
function ToolbarRule() {
  return <Separator orientation="vertical" className="mx-1.5 h-6 shrink-0" />;
}
function ToolButton(props: {
  label: string;
  Icon: ComponentType<{ size?: number }>;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active}
      className={cn("misty-tiptap-tool", props.active && "is-active")}
      onClick={props.onClick}
    >
      <props.Icon size={17} />
    </Button>
  );
}

function SearchReplacePanel(props: {
  editor: Editor;
  open: boolean;
  search: string;
  replace: string;
  onSearchChange: (value: string) => void;
  onReplaceChange: (value: string) => void;
  onClose: () => void;
}) {
  if (!props.open) return null;
  const commands = findCommands(props.editor);
  return (
    <div className="misty-tiptap-search" role="search">
      <Input
        autoFocus
        value={props.search}
        placeholder="Find"
        aria-label="Find text"
        onChange={(event) => props.onSearchChange(event.target.value)}
      />
      <Input
        value={props.replace}
        placeholder="Replace"
        aria-label="Replacement text"
        onChange={(event) => props.onReplaceChange(event.target.value)}
      />
      <Button size="sm" variant="ghost" onClick={() => commands.goToPreviousResult()}>
        Previous
      </Button>
      <Button size="sm" variant="ghost" onClick={() => commands.goToNextResult()}>
        Next
      </Button>
      <Button size="sm" variant="ghost" onClick={() => commands.replace()}>
        Replace
      </Button>
      <Button size="sm" variant="ghost" onClick={() => commands.replaceAll()}>
        All
      </Button>
      <Button size="icon" variant="ghost" aria-label="Close search" onClick={props.onClose}>
        <Minus size={16} />
      </Button>
    </div>
  );
}

function BlockHandle(props: {
  editor: Editor;
  block: { pos: number; node: JSONContent } | null;
  noteId: string;
}) {
  const { editor, block } = props;
  const pos = block?.pos ?? Math.max(0, editor.state.selection.$from.before(1));
  const node = editor.state.doc.nodeAt(pos);
  const range = node ? { from: pos, to: pos + node.nodeSize } : null;
  return (
    <div className="misty-tiptap-block-handle" data-misty-window-drag-block="true">
      <button
        type="button"
        aria-label="Add block"
        title="Add block"
        onClick={() => editor.chain().focus().insertContentAt(pos, { type: "paragraph" }).run()}
      >
        <Plus size={16} />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Block actions" title="Drag or open block actions">
            <GripVertical size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="left" className="w-52">
          <DropdownMenuItem onSelect={() => editor.chain().focus().setParagraph().run()}>
            <Pilcrow />
            Turn into text
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading />
            Turn into heading
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!range}
            onSelect={() =>
              range &&
              editor
                .chain()
                .focus()
                .setTextSelection(range)
                .toggleHighlight({ color: "#7255d9" })
                .run()
            }
          >
            <Highlighter />
            Highlight block
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!node}
            onSelect={() =>
              node &&
              editor
                .chain()
                .focus()
                .insertContentAt(pos + node.nodeSize, node.toJSON())
                .run()
            }
          >
            <Copy />
            Duplicate block
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!node}
            onSelect={() => node && void navigator.clipboard.writeText(node.textContent)}
          >
            <Copy />
            Copy to clipboard
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              void navigator.clipboard.writeText(
                `misty://notes/${props.noteId}#${String(node?.attrs.id || `block-${pos}`)}`,
              )
            }
          >
            <Link2 />
            Copy anchor link
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!range}
            className="text-red-300"
            onSelect={() => range && editor.chain().focus().deleteRange(range).run()}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

type SuggestionState = {
  type: "slash" | "wiki";
  query: string;
  from: number;
  to: number;
  x: number;
  y: number;
};
function updateSuggestion(editor: Editor, set: (value: SuggestionState | null) => void) {
  const { $from } = editor.state.selection;
  if (!$from.parent.isTextblock) return set(null);
  const before = $from.parent.textBetween(0, $from.parentOffset, "\n", "\n");
  const wiki = before.match(/\[\[([^\]]*)$/);
  const slash = before.match(/(?:^|\s)\/([a-z\s]*)$/i);
  const match = wiki ?? slash;
  if (!match) return set(null);
  const coords = editor.view.coordsAtPos(editor.state.selection.from);
  set({
    type: wiki ? "wiki" : "slash",
    query: match[1] ?? "",
    from: editor.state.selection.from - match[0].trimStart().length,
    to: editor.state.selection.from,
    x: coords.left,
    y: coords.bottom + 8,
  });
}

function SuggestionMenu(props: {
  editor: Editor;
  suggestion: SuggestionState;
  notes: Array<{ id: string; title: string }>;
  onClose: () => void;
}) {
  const slashItems = [
    { label: "Text", icon: Pilcrow, run: () => props.editor.chain().focus().setParagraph().run() },
    {
      label: "Heading 1",
      icon: Heading,
      run: () => props.editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: "Heading 2",
      icon: Heading,
      run: () => props.editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "Bullet list",
      icon: List,
      run: () => props.editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      icon: ListOrdered,
      run: () => props.editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "To-do list",
      icon: ListChecks,
      run: () => props.editor.chain().focus().toggleTaskList().run(),
    },
    {
      label: "Blockquote",
      icon: Quote,
      run: () => props.editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "Code block",
      icon: Braces,
      run: () => props.editor.chain().focus().toggleCodeBlock().run(),
    },
  ].filter((item) => item.label.toLowerCase().includes(props.suggestion.query.toLowerCase()));
  const notes = props.notes
    .filter((note) => note.title.toLowerCase().includes(props.suggestion.query.toLowerCase()))
    .slice(0, 8);
  return (
    <div
      className="misty-tiptap-suggestion"
      style={{ left: props.suggestion.x, top: props.suggestion.y }}
      role="listbox"
    >
      <p>{props.suggestion.type === "wiki" ? "Link to note" : "Insert block"}</p>
      {props.suggestion.type === "slash"
        ? slashItems.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                props.editor
                  .chain()
                  .focus()
                  .deleteRange({ from: props.suggestion.from, to: props.suggestion.to })
                  .run();
                item.run();
                props.onClose();
              }}
            >
              <item.icon size={16} />
              {item.label}
            </button>
          ))
        : notes.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => {
                props.editor
                  .chain()
                  .focus()
                  .deleteRange({ from: props.suggestion.from, to: props.suggestion.to })
                  .insertContent({
                    type: "text",
                    text: note.title,
                    marks: [{ type: "link", attrs: { href: `misty-note://${note.id}` } }],
                  })
                  .run();
                props.onClose();
              }}
            >
              <Link2 size={16} />
              {note.title}
            </button>
          ))}
      {props.suggestion.type === "wiki" && notes.length === 0 ? (
        <span>No matching notes</span>
      ) : null}
    </div>
  );
}

type FindCommands = {
  setSearchTerm: (value: string) => boolean;
  setReplaceTerm: (value: string) => boolean;
  goToPreviousResult: () => boolean;
  goToNextResult: () => boolean;
  replace: () => boolean;
  replaceAll: () => boolean;
};
function findCommands(editor: Editor) {
  return editor.commands as unknown as FindCommands;
}
function initialContent(
  props: Pick<NoteBlockEditorProps, "body" | "bodyFormat" | "bodyMarkdown">,
): string | JSONContent {
  if (props.bodyFormat === "tiptap-json") {
    try {
      return JSON.parse(props.body) as JSONContent;
    } catch {
      return { type: "doc", content: [{ type: "paragraph" }] };
    }
  }
  return props.bodyMarkdown ?? props.body ?? "";
}

function replaceYText(text: YText, value: string) {
  if (text.toString() === value) return;
  text.doc?.transact(() => {
    text.delete(0, text.length);
    text.insert(0, value);
  }, "misty-projection");
}
function applyPendingMarkdown(editor: Editor, session?: NoteEditorSession) {
  if (!session) return;
  const awareness = session.provider.awareness;
  const connectedClients = [...awareness.getStates().keys()].sort((left, right) => left - right);
  if (connectedClients[0] !== awareness.clientID) return;
  const pending = Number(session.metadata.get("pending_version") ?? 0);
  const applied = Number(session.metadata.get("applied_version") ?? 0);
  const markdown = String(session.metadata.get("pending_markdown") ?? "");
  if (!pending || pending <= applied) return;
  editor.commands.setContent(markdown, { contentType: "markdown" });
  session.metadata.set("applied_version", pending);
}
function collectNoteLinks(editor: Editor): string[] {
  const ids = new Set<string>();
  editor.state.doc.descendants((node) => {
    for (const mark of node.marks) {
      const id = noteIdFromHref(String(mark.attrs.href ?? ""));
      if (id) ids.add(id);
    }
  });
  return [...ids].sort();
}
function noteIdFromHref(href: string): string | null {
  const match = href.match(/^misty-note:\/\/(note_[A-Za-z0-9-]+)$/);
  return match?.[1] ?? null;
}
function collaborationUser(accountId?: string) {
  const seed = accountId ?? "misty-user";
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  const colors = ["#8b7cf6", "#48a889", "#d09a55", "#cf6f79", "#5b91d5"];
  return { name: "Misty collaborator", color: colors[Math.abs(hash) % colors.length] };
}

export default NoteBlockEditorView;
