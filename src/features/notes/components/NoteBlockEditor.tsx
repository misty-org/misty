import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./noteBlockEditor.css";

import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { useCallback, useEffect, useRef } from "react";
import { useAppThemeStore } from "@/stores/app/useAppThemeStore";
import { cn } from "@/ui";

interface NoteBlockEditorProps {
  editable: boolean;
  markdown: string;
  onMarkdownChange?: (markdown: string) => void;
}

export function NoteBlockEditor(props: NoteBlockEditorProps) {
  const editor = useCreateBlockNote();
  const resolvedTheme = useAppThemeStore((state) => state.resolvedTheme);
  const loadedMarkdownRef = useRef<string | null>(null);
  const onMarkdownChangeRef = useRef(props.onMarkdownChange);

  useEffect(() => {
    onMarkdownChangeRef.current = props.onMarkdownChange;
  }, [props.onMarkdownChange]);

  useEffect(() => {
    if (loadedMarkdownRef.current === props.markdown) return;
    const blocks = editor.tryParseMarkdownToBlocks(props.markdown);
    editor.replaceBlocks(editor.document, blocks);
    loadedMarkdownRef.current = props.markdown;
  }, [editor, props.markdown]);

  useEffect(() => {
    if (!props.editable) return;
    queueMicrotask(() => editor.focus());
  }, [editor, props.editable]);

  const handleChange = useCallback(() => {
    const markdown = editor.blocksToMarkdownLossy(editor.document);
    loadedMarkdownRef.current = markdown;
    onMarkdownChangeRef.current?.(markdown);
  }, [editor]);

  return (
    <div className={cn("misty-note-block-editor", !props.editable && "is-readonly")}>
      <BlockNoteView
        editor={editor}
        editable={props.editable}
        onChange={props.editable ? handleChange : undefined}
        theme={resolvedTheme}
      />
    </div>
  );
}

export default NoteBlockEditor;
