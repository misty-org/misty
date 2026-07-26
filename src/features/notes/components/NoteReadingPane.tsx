import type {
  NoteContentDraft,
  NoteReadingPaneProps,
} from "@/models/interfaces/features/notes/components/NoteReadingPane";
export type { NoteReadingPaneProps } from "@/models/interfaces/features/notes/components/NoteReadingPane";
import { Suspense, lazy, useEffect, useState } from "react";
import { Check, FileText, PenLine, Plus, Star, X } from "lucide-react";
import { Button, EmptyState, Skeleton, cn } from "@/ui";
import { relativeTime } from "@/features/notes/noteFilters";
import { NoteSyncIndicator } from "./NoteSourceBadge";

const NoteBlockEditor = lazy(() => import("./NoteBlockEditor"));

const paneClass = "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background";

const headerClass = "shrink-0 border-b border-border px-5 py-3.5";

const noteBodyClass = "mx-auto w-full max-w-[760px] px-5 py-6";

const editableNoteBodyClass = "mx-auto w-full min-w-[520px] max-w-[760px] py-6 pl-16 pr-5";

export function NoteReadingPane(props: NoteReadingPaneProps) {
  const { note } = props;
  const [draft, setDraft] = useState<NoteContentDraft>({
    body: "",
    bodyFormat: "markdown" as const,
    bodyMarkdown: undefined as string | undefined,
  });
  const editing = Boolean(note && props.editingNoteId === note.id);

  useEffect(() => {
    if (!editing) setDraft(noteContent(note));
  }, [editing, note?.body, note?.bodyFormat, note?.bodyMarkdown, note?.id]);

  if (props.loading) return <ReadingPaneSkeleton />;

  if (!note) {
    return (
      <div className={paneClass}>
        <div className="row-span-2 grid place-items-center">
          <EmptyState
            icon={<FileText />}
            title="No note selected"
            description="Pick a note from the list, or start a new one in Misty."
            action={
              <Button type="button" size="sm" className="gap-1.5" onClick={props.onNewNote}>
                <Plus size={14} strokeWidth={2.2} />
                New note
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  // Editability is a connector capability, not a per-source special case: the
  // pane offers Edit only when the store handed down a save handler.
  const editable = Boolean(props.onSaveBody || props.onSaveContent);

  return (
    <article className={paneClass} aria-label={note.title}>
      <header className={headerClass}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] font-semibold leading-tight text-foreground">
              {note.title}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span>{note.spaceName}</span>
              <span aria-hidden="true">·</span>
              <span>Updated {relativeTime(note.updatedAt)}</span>
              <NoteSyncIndicator status={note.syncStatus} className="ml-0.5" />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {props.onToggleFavorite ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={note.favorite ? "Remove from favorites" : "Add to favorites"}
                className="size-8"
                onClick={() => props.onToggleFavorite?.(note.id)}
              >
                <Star size={14} className={cn(note.favorite && "fill-amber-500 text-amber-500")} />
              </Button>
            ) : null}

            {editable ? (
              editing ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => {
                      setDraft(noteContent(note));
                      props.onEditingNoteChange?.(undefined);
                    }}
                  >
                    <X size={13} />
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => {
                      if (props.onSaveContent) {
                        props.onSaveContent(note.id, draft);
                      } else {
                        props.onSaveBody?.(note.id, draft.bodyMarkdown ?? draft.body);
                      }
                      props.onEditingNoteChange?.(undefined);
                    }}
                  >
                    <Check size={13} />
                    Save
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => props.onEditingNoteChange?.(note.id)}
                >
                  <PenLine size={13} />
                  Edit
                </Button>
              )
            ) : null}
          </div>
        </div>
      </header>

      <div className="misty-scrollbar min-h-0 overflow-auto overscroll-contain">
        {editing ? (
          <div className={editableNoteBodyClass}>
            <Suspense fallback={<Skeleton className="h-[420px] w-full" />}>
              <NoteBlockEditor
                key={note.id}
                editable
                autoFocus
                noteId={note.id}
                accountId={props.accountId}
                spaceId={note.spaceId}
                body={draft.body}
                bodyFormat={draft.bodyFormat}
                bodyMarkdown={draft.bodyMarkdown}
                onContentChange={setDraft}
              />
            </Suspense>
          </div>
        ) : (
          <div className={noteBodyClass}>
            <Suspense fallback={<Skeleton className="h-48 w-full" />}>
              <NoteBlockEditor
                key={note.id}
                editable={false}
                noteId={note.id}
                accountId={props.accountId}
                spaceId={note.spaceId}
                body={note.body}
                bodyFormat={note.bodyFormat}
                bodyMarkdown={note.bodyMarkdown}
              />
            </Suspense>
          </div>
        )}
      </div>
    </article>
  );
}

function noteContent(note: NoteReadingPaneProps["note"]) {
  return {
    body: note?.body ?? "",
    bodyFormat: note?.bodyFormat ?? "markdown",
    bodyMarkdown: note?.bodyMarkdown,
  };
}

function ReadingPaneSkeleton() {
  return (
    <div className={paneClass} aria-hidden="true">
      <div className={headerClass}>
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="mt-2 h-3 w-1/3" />
      </div>
      <div className="mx-auto w-full max-w-[680px] space-y-3 px-5 py-6">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <Skeleton key={row} className={row % 3 === 2 ? "h-3 w-3/5" : "h-3 w-full"} />
        ))}
      </div>
    </div>
  );
}
