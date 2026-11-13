import { Button, EmptyState, Surface, useNotice } from "@/shared/ui";
import { ClipboardCopy } from "lucide-react";
import { Suspense, useState, type ComponentType } from "react";
import type { UnifiedNote } from "../noteTypes";

import type { NoteBlockEditorProps } from "./NoteBlockEditorView";
import { NoteDocumentSkeleton } from "./NoteDocumentSkeleton";
interface NotePreviewRuntime {
  Editor: ComponentType<Omit<NoteBlockEditorProps, "runtime">>;
  copy(text: string): Promise<void>;
  report(error: unknown): void;
}

export interface NotePreviewProps {
  note: UnifiedNote;
  accountId?: string;
  linkableNotes: UnifiedNote[];
}
export function NotePreviewView(props: NotePreviewProps & { runtime: NotePreviewRuntime }) {
  const [copyFailed, setCopyFailed] = useState(false);
  useNotice(copyFailed, {
    message: "Copy failed. Try Copy to clipboard again or select and copy the text.",
    tone: "error",
    onDismiss: () => setCopyFailed(false),
  });
  const NoteBlockEditor = props.runtime.Editor;
  const noteText = props.note.bodyMarkdown ?? props.note.preview ?? props.note.body;
  const linkableNotes = props.linkableNotes
    .filter((candidate) => candidate.id !== props.note.id && candidate.source === "misty")
    .map((candidate) => ({ id: candidate.sourceId, title: candidate.title }));

  const copyToClipboard = async () => {
    setCopyFailed(false);
    try {
      await props.runtime.copy(noteText);
    } catch (error) {
      setCopyFailed(true);
      props.runtime.report(error);
    }
  };

  return (
    <Surface
      tone="page"
      className="grid h-full min-h-0 grid-rows-[48px_minmax(0,1fr)] overflow-hidden"
    >
      <Surface
        tone="card"
        className="flex min-w-0 items-center gap-1 border-b px-2"
        role="toolbar"
        aria-label="Doc preview tools"
      >
        <Button
          type="button"
          variant="quiet"
          className="shrink-0 gap-1.5 text-xs"
          disabled={!noteText.trim()}
          onClick={() => void copyToClipboard()}
        >
          <ClipboardCopy />
          Copy to clipboard
        </Button>
      </Surface>

      <div className="misty-scrollbar min-h-0 overflow-auto">
        {noteText.trim() ? (
          <Suspense fallback={<NoteDocumentSkeleton label="Preparing doc preview" />}>
            <NoteBlockEditor
              key={props.note.id}
              editable={false}
              noteId={props.note.sourceId}
              accountId={props.accountId}
              spaceId={props.note.spaceId}
              body={props.note.body}
              bodyFormat={props.note.bodyFormat}
              bodyMarkdown={props.note.bodyMarkdown}
              linkableNotes={linkableNotes}
            />
          </Suspense>
        ) : (
          <EmptyState title="This doc is empty" line="Open the doc to start writing." />
        )}
      </div>
    </Surface>
  );
}
