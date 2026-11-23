import { isChangeOrigin } from "@tiptap/extension-collaboration";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo } from "react";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { createNoteEditorExtensions } from "./note_editor_extensions";
import "./note_tiptap_editor.css";

export interface LabNoteBodyEditorProps {
  fragment: Y.XmlFragment;
  awareness: Awareness;
  user: { id: string; name: string; color: string };
  seed?: string;
  onSeeded?(): void;
  editable: boolean;
  label: string;
  onMarkdown(markdown: string): void;
  onFocusChange?(focused: boolean): void;
}

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
