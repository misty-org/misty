import type {
  NoteContentDraft,
  NoteReadingPaneProps,
} from "@/models/interfaces/features/notes/components/NoteReadingPane";
export type { NoteReadingPaneProps } from "@/models/interfaces/features/notes/components/NoteReadingPane";
import { Suspense, lazy, useEffect, useState } from "react";
import { Check, PenLine, Star, Trash2, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  EmptyState,
  Skeleton,
  cn,
} from "@/ui";
import { relativeTime } from "@/features/notes/noteFilters";
import { NoteSyncIndicator } from "./NoteSourceBadge";

const NoteBlockEditor = lazy(() => import("./NoteBlockEditor"));

const paneClass = "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background";

const headerClass = "shrink-0 border-b border-border px-5 py-3.5";

const noteBodyClass = "w-full px-[clamp(24px,4vw,56px)] py-6";

const editableNoteBodyClass = "w-full min-w-0 py-6 pl-16 pr-5";

export function NoteReadingPane(props: NoteReadingPaneProps) {
  const { note } = props;
  const [draft, setDraft] = useState<NoteContentDraft>({
    body: "",
    bodyFormat: "markdown" as const,
    bodyMarkdown: undefined as string | undefined,
  });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const editing = Boolean(note && props.editingNoteId === note.id);

  useEffect(() => {
    if (!editing) setDraft(noteContent(note));
  }, [editing, note?.body, note?.bodyFormat, note?.bodyMarkdown, note?.id]);
  useEffect(() => {
    setDeleteOpen(false);
    setDeleting(false);
    setDeleteError("");
  }, [note?.id]);

  if (props.loading) return <ReadingPaneSkeleton />;

  if (!note) {
    return (
      <div className={paneClass}>
        <div className="row-span-2 grid place-items-center">
          <EmptyState
            title={props.hasNotes ? "Select a note" : "No notes yet"}
            description={
              props.hasNotes
                ? "Choose a note from the list to open it."
                : "Create a note to keep this Space's work close by."
            }
            className="max-w-sm px-6 py-8"
          />
        </div>
      </div>
    );
  }

  const collaborative = note.source === "misty" && Boolean(note.spaceId);
  const editable = Boolean(props.onSaveBody || props.onSaveContent);
  const bodyEditable = collaborative || editable;

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

            {props.onDelete && !editing ? (
              <AlertDialog
                open={deleteOpen}
                onOpenChange={(open) => {
                  setDeleteOpen(open);
                  if (!open) setDeleteError("");
                }}
              >
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    title="Delete note"
                    aria-label="Delete note"
                  >
                    <Trash2 size={14} />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this note?</AlertDialogTitle>
                    <AlertDialogDescription>
                      “{note.title}” and its collaborative history will be permanently removed.
                    </AlertDialogDescription>
                    {deleteError ? (
                      <p className="m-0 text-sm text-destructive" role="alert">
                        {deleteError}
                      </p>
                    ) : null}
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      disabled={deleting}
                      onClick={(event) => {
                        event.preventDefault();
                        if (deleting) return;
                        setDeleting(true);
                        setDeleteError("");
                        void props
                          .onDelete?.(note.id)
                          .then(() => setDeleteOpen(false))
                          .catch((reason: unknown) => {
                            setDeleteError(
                              reason instanceof Error && reason.message
                                ? reason.message
                                : "Could not delete this note.",
                            );
                          })
                          .finally(() => setDeleting(false));
                      }}
                    >
                      {deleting ? "Deleting…" : "Delete note"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
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
        {collaborative ? (
          <div className={editableNoteBodyClass}>
            <Suspense fallback={<Skeleton className="h-[420px] w-full" />}>
              <NoteBlockEditor
                key={note.id}
                editable={bodyEditable}
                collaborative
                autoFocus
                noteId={note.sourceId}
                accountId={props.accountId}
                spaceId={note.spaceId}
                body={note.body}
                bodyFormat={note.bodyFormat}
                bodyMarkdown={note.bodyMarkdown}
              />
            </Suspense>
          </div>
        ) : editing ? (
          <div className={editableNoteBodyClass}>
            <Suspense fallback={<Skeleton className="h-[420px] w-full" />}>
              <NoteBlockEditor
                key={note.id}
                editable
                autoFocus
                noteId={note.sourceId}
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
                noteId={note.sourceId}
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
      <div className="w-full space-y-3 px-[clamp(24px,4vw,56px)] py-6">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <Skeleton key={row} className={row % 3 === 2 ? "h-3 w-3/5" : "h-3 w-full"} />
        ))}
      </div>
    </div>
  );
}
