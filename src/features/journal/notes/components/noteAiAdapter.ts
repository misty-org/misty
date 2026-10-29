import type {
  AiArtifact,
  AiSelectionSnapshot,
  AiSuggestedAction,
  AiSurfaceAdapter,
} from "@/features/ai-surface/types";
import type { AiContextReference } from "@/features/ai-surface/types";
import type { Editor } from "@tiptap/react";
import { noteIdFromHref } from "./noteEditorContent";
import type { NoteAiSelection, NoteBlockEditorProps, NoteEditorSession } from "./noteEditorTypes";

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
export function createNoteAiAdapter(
  editor: Editor,
  props: NoteBlockEditorProps & {
    session?: NoteEditorSession;
  },
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
export function updateAiSelection(
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
      anchors: {
        from,
        to,
        editor: "tiptap-prosemirror-v1",
      },
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
  if (props.readOnlyReason) throw new Error(props.readOnlyReason);
  if (!canApplyNoteArtifact(editor, props, artifact)) {
    throw new Error("The note selection changed. Ask your agent to regenerate this draft.");
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
