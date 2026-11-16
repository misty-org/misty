import { isChangeOrigin } from "@tiptap/extension-collaboration";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo } from "react";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { createNoteEditorExtensions } from "./noteEditorExtensions";
import "./noteTiptapEditor.css";

export interface LabNoteBodyEditorProps {
  /** The note's body in its notebook's doc. */
  fragment: Y.XmlFragment;
  /** The notebook room's awareness, where this person's caret is published. */
  awareness: Awareness;
  user: { id: string; name: string; color: string };
  /** Markdown to start from when the shared text is empty or behind; taken once. */
  seed?: string;
  onSeeded?(): void;
  editable: boolean;
  label: string;
  /** The note as Markdown after this person's own edit, for the notebook's readable copy. */
  onMarkdown(markdown: string): void;
  onFocusChange?(focused: boolean): void;
}

/**
 * A Lab note's body, edited together: the Space note editor on one fragment of the notebook's
 * doc, with everyone's carets. Only the person who made a change reports its Markdown, so the
 * readable copy is written once per edit.
 */
export function LabNoteBodyEditor(props: LabNoteBodyEditorProps) {
  const { fragment, awareness, user, onMarkdown, onFocusChange } = props;
  const extensions = useMemo(
    () =>
      createNoteEditorExtensions({
        runtime: {},
        accountId: user.id,
        userName: user.name,
        caretColor: user.color,
        session: { fragment, provider: { awareness } },
      }),
    [fragment, awareness, user.id, user.name, user.color],
  );
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: props.editable,
      extensions,
      editorProps: {
        attributes: {
          autocomplete: "off",
          autocorrect: "on",
          autocapitalize: "sentences",
          spellcheck: "true",
          "aria-label": props.label,
          class: "misty-tiptap-prosemirror",
          "data-misty-window-drag-block": "true",
        },
      },
      onUpdate: ({ editor: updated, transaction }) => {
        if (isChangeOrigin(transaction)) return;
        onMarkdown(updated.getMarkdown());
      },
      onFocus: () => onFocusChange?.(true),
      onBlur: () => onFocusChange?.(false),
    },
    [extensions],
  );
  useEffect(() => editor?.setEditable(props.editable), [editor, props.editable]);
  const { seed, onSeeded } = props;
  useEffect(() => {
    if (!editor || seed === undefined) return;
    editor.commands.setContent(seed, { contentType: "markdown" });
    onSeeded?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, seed]);
  return <EditorContent editor={editor} role="presentation" />;
}
