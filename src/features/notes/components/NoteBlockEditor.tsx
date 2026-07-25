import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./noteBlockEditor.css";

import type { NoteBodyFormat } from "@/models/types/features/notes/types";
import { BlockNoteSchema, createCodeBlockSpec, defaultBlockSpecs } from "@blocknote/core";
import { codeBlockOptions } from "@blocknote/code-block";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { useCallback, useEffect, useRef } from "react";
import { useAppThemeStore } from "@/stores/app/useAppThemeStore";
import { cn } from "@/ui";
import { resolveNoteAssetUrl, uploadNoteAsset } from "@/features/notes/noteAssets";

const mistyNotesSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock: createCodeBlockSpec(codeBlockOptions),
  },
});

interface NoteBlockEditorProps {
  editable: boolean;
  noteId: string;
  accountId?: string;
  spaceId?: string;
  body: string;
  bodyFormat: NoteBodyFormat;
  bodyMarkdown?: string;
  autoFocus?: boolean;
  onContentChange?: (content: {
    body: string;
    bodyFormat: "blocknote-json";
    bodyMarkdown: string;
  }) => void;
}

export function NoteBlockEditor(props: NoteBlockEditorProps) {
  const editor = useCreateBlockNote({
    schema: mistyNotesSchema,
    uploadFile: (file) =>
      uploadNoteAsset({
        accountId: props.accountId,
        spaceId: props.spaceId,
        noteId: props.noteId,
        file,
      }),
    resolveFileUrl: resolveNoteAssetUrl,
  });
  const resolvedTheme = useAppThemeStore((state) => state.resolvedTheme);
  const loadedContentRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const onContentChangeRef = useRef(props.onContentChange);

  useEffect(() => {
    onContentChangeRef.current = props.onContentChange;
  }, [props.onContentChange]);

  useEffect(() => {
    const contentKey = [props.bodyFormat, props.body, props.bodyMarkdown ?? ""].join("\u0000");
    if (loadedContentRef.current === contentKey) return;
    loadingRef.current = true;
    try {
      const blocks =
        props.bodyFormat === "blocknote-json"
          ? JSON.parse(props.body)
          : editor.tryParseMarkdownToBlocks(props.bodyMarkdown ?? props.body);
      editor.replaceBlocks(editor.document, blocks);
      loadedContentRef.current = contentKey;
    } catch {
      const blocks = editor.tryParseMarkdownToBlocks(props.bodyMarkdown ?? "");
      editor.replaceBlocks(editor.document, blocks);
      loadedContentRef.current = contentKey;
    } finally {
      loadingRef.current = false;
    }
  }, [editor, props.body, props.bodyFormat, props.bodyMarkdown]);

  useEffect(() => {
    if (!props.editable || !props.autoFocus) return;
    const frame = window.requestAnimationFrame(() => editor.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [editor, props.autoFocus, props.editable]);

  const handleChange = useCallback(() => {
    if (loadingRef.current) return;
    const body = JSON.stringify(editor.document);
    const bodyMarkdown = editor.blocksToMarkdownLossy(editor.document);
    loadedContentRef.current = ["blocknote-json", body, bodyMarkdown].join("\u0000");
    onContentChangeRef.current?.({
      body,
      bodyFormat: "blocknote-json",
      bodyMarkdown,
    });
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
