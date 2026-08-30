import { reportSystemError } from "@/features/activity";
import { Button, EmptyState, Skeleton } from "@/shared/ui";
import { ClipboardCopy } from "lucide-react";
import { lazy, Suspense } from "react";
import type { UnifiedNote } from "../model/types/types";

const NoteBlockEditor = lazy(() => import("./NoteBlockEditor"));

export function NotePreview(props: {
  note: UnifiedNote;
  accountId?: string;
  linkableNotes: UnifiedNote[];
}) {
  const noteText = props.note.bodyMarkdown ?? props.note.preview ?? props.note.body;
  const linkableNotes = props.linkableNotes
    .filter((candidate) => candidate.id !== props.note.id && candidate.source === "misty")
    .map((candidate) => ({ id: candidate.sourceId, title: candidate.title }));

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(noteText);
    } catch (error) {
      reportSystemError({
        accountId: props.accountId,
        error,
        scope: `notes:${props.note.spaceId ?? "unknown"}:${props.note.sourceId}:copy`,
        title: "Note could not be copied",
      });
    }
  };

  return (
    <div className="grid h-full min-h-0 grid-rows-[48px_minmax(0,1fr)] overflow-hidden bg-charcoal-bg">
      <div
        className="flex min-w-0 items-center gap-1 border-b border-charcoal-border bg-charcoal-card px-2"
        role="toolbar"
        aria-label="Note preview tools"
      >
        <Button
          type="button"
          variant="ghost"
          className="h-8 shrink-0 gap-1.5 px-2 text-xs text-cream-muted hover:text-cream-bright"
          disabled={!noteText.trim()}
          onClick={() => void copyToClipboard()}
        >
          <ClipboardCopy className="size-3.5" />
          Copy to clipboard
        </Button>
      </div>

      <div className="misty-scrollbar min-h-0 overflow-auto">
        {noteText.trim() ? (
          <Suspense
            fallback={
              <div className="space-y-3 p-8" aria-label="Preparing note preview">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            }
          >
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
          <EmptyState
            className="h-full"
            title="This note is empty"
            description="Open the note to start writing."
          />
        )}
      </div>
    </div>
  );
}
