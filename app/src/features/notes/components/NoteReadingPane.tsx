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
} from "@/shared/ui";
import { Check, ExternalLink, LoaderCircle, PenLine, Send, Star, Trash2, X } from "lucide-react";
import { Suspense, lazy, useEffect, useState } from "react";
import type { NoteBodyFormat, UnifiedNote } from "../model/types/types";
import { relativeTime } from "../noteFilters";
import { NoteSourceBadge, NoteSyncIndicator } from "./NoteSourceBadge";

const NoteBlockEditor = lazy(() => import("./NoteBlockEditor"));

const paneClass = "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-charcoal-bg";

const headerClass =
  "flex min-h-11 shrink-0 items-center gap-2 border-b border-charcoal-border bg-charcoal-bg px-3 py-1.5";

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
  }, [editing, note]);
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

  const collaborative = !props.referenceOnly && note.source === "misty" && Boolean(note.spaceId);
  const editable = Boolean(props.onSaveBody || props.onSaveContent);
  const bodyEditable = collaborative || editable;

  return (
    <article className={paneClass} aria-label={note.title}>
      <header className={headerClass}>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 truncate text-sm font-semibold leading-tight text-cream">
            {note.title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-cream-muted">
            <span>{note.spaceName}</span>
            <span aria-hidden="true">·</span>
            <span>Updated {relativeTime(note.updatedAt)}</span>
            <NoteSourceBadge source={note.source} />
            <NoteSyncIndicator status={note.syncStatus} className="ml-0.5" />
            {props.publishError ? <span className="text-sage-fg">{props.publishError}</span> : null}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {note.source === "notion" && props.onOpenInSource ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => props.onOpenInSource?.(note.id)}
            >
              <ExternalLink size={13} />
              Open in Notion
            </Button>
          ) : null}
          {note.source === "misty" && props.onPublish ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              disabled={props.publishing}
              onClick={() => props.onPublish?.(note.id)}
            >
              {props.publishing ? (
                <LoaderCircle size={13} className="animate-spin" />
              ) : (
                <Send size={13} />
              )}
              {props.publishing ? "Publishing…" : "Publish to Notion"}
            </Button>
          ) : null}
          {props.onToggleFavorite ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={note.favorite ? "Remove from favorites" : "Add to favorites"}
              className="size-8"
              onClick={() => props.onToggleFavorite?.(note.id)}
            >
              <Star size={14} className={cn(note.favorite && "fill-sage-fg text-sage-fg")} />
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
                  className="size-8 text-cream-muted hover:text-cream-bright"
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
                    <p className="m-0 text-sm text-cream-bright" role="alert">
                      {deleteError}
                    </p>
                  ) : null}
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-charcoal-active text-cream-bright hover:bg-charcoal-active"
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

export interface NoteContentDraft {
  body: string;
  bodyFormat: NoteBodyFormat;
  bodyMarkdown?: string;
}

export interface NoteReadingPaneProps {
  note?: UnifiedNote;
  hasNotes?: boolean;
  accountId?: string;
  loading: boolean;
  editingNoteId?: string;
  referenceOnly?: boolean;
  onEditingNoteChange?: (noteId: string | undefined) => void;
  /** Undefined for read-only sources; presence enables the Edit affordance. */
  onSaveBody?: (noteId: string, body: string) => void;
  onSaveContent?: (noteId: string, content: NoteContentDraft) => void;
  onDelete?: (noteId: string) => Promise<void>;
  onToggleFavorite?: (noteId: string) => void;
  onNewNote: () => void;
  onOpenInSource?: (noteId: string) => void;
  onPublish?: (noteId: string) => void;
  publishing?: boolean;
  publishError?: string;
}

export interface NoteConflictNoticeProps {
  note: UnifiedNote;
}
