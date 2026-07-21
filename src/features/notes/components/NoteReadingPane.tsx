import type { NoteReadingPaneProps } from "@/models/interfaces/features/notes/components/NoteReadingPane";
export type { NoteReadingPaneProps } from "@/models/interfaces/features/notes/components/NoteReadingPane";
import { Suspense, lazy, useEffect, useState } from "react";
import { Check, ExternalLink, FileText, PenLine, Plus, Star, Upload, X } from "lucide-react";
import { Button, EmptyState, ScrollArea, Skeleton, Textarea, cn } from "@/ui";
import { relativeTime } from "@/features/notes/noteFilters";
import { NoteSourceIcon, NoteSyncIndicator } from "./NoteSourceBadge";
import { ConflictNotice } from "./NotesConnectionCards";

const ReactMarkdown = lazy(() => import("react-markdown"));

const paneClass = "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background";

const headerClass = "shrink-0 border-b border-border px-5 py-3.5";

const proseClass = [
  "mx-auto max-w-[680px] px-5 py-6 text-[13.5px] leading-[1.65] text-foreground/90",
  "[&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:text-foreground",
  "[&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-[13.5px] [&_h3]:font-semibold [&_h3]:text-foreground",
  "[&_p]:mb-3.5",
  "[&_ul]:mb-3.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-3.5 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:mb-1",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px]",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3",
  "[&_blockquote]:italic [&_blockquote]:text-muted-foreground",
  "[&_table]:mb-3.5 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[12.5px]",
  "[&_th]:border [&_th]:border-border [&_th]:bg-muted/40 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
  "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
  "[&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline",
].join(" ");

export function NoteReadingPane(props: NoteReadingPaneProps) {
  const { note } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setEditing(false);
    setDraft(note?.body ?? "");
  }, [note?.id, note?.body]);

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
  const editable = Boolean(props.onSaveBody);

  return (
    <article className={paneClass} aria-label={note.title}>
      <header className={headerClass}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] font-semibold leading-tight text-foreground">
              {note.title}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <NoteSourceIcon source={note.source} size={11} />
                {note.source === "notion" ? "Notion" : "Misty Notes"}
              </span>
              <span aria-hidden="true">·</span>
              <span>{note.spaceName ?? "Unlinked"}</span>
              <span aria-hidden="true">·</span>
              <span>
                {note.syncStatus === "local-only"
                  ? "Never synced"
                  : `Synced ${relativeTime(note.updatedAt)}`}
              </span>
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
                      setDraft(note.body);
                      setEditing(false);
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
                      props.onSaveBody?.(note.id, draft);
                      setEditing(false);
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
                  onClick={() => setEditing(true)}
                >
                  <PenLine size={13} />
                  Edit
                </Button>
              )
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => props.onOpenInSource(note.id)}
              >
                <ExternalLink size={13} />
                Open in Notion
              </Button>
            )}
            {props.onPublishToNotion && note.source === "misty" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5"
                disabled={props.publishing}
                onClick={() => props.onPublishToNotion?.(note.id)}
                title="Create a Notion page from this note"
              >
                <Upload size={13} />
                {props.publishing ? "Publishing…" : "Publish to Notion"}
              </Button>
            ) : null}
          </div>
        </div>

        {note.syncStatus === "conflict" ? (
          <div className="mt-3">
            <ConflictNotice onOpenInSource={() => props.onOpenInSource(note.id)} />
          </div>
        ) : null}
      </header>

      <ScrollArea className="min-h-0">
        {editing ? (
          <div className="mx-auto max-w-[680px] px-5 py-6">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label="Note body"
              className="min-h-[420px] resize-none font-mono text-[12.5px] leading-[1.7]"
            />
          </div>
        ) : (
          <div className={proseClass}>
            <Suspense fallback={<Skeleton className="h-40 w-full" />}>
              <ReactMarkdown>{note.body}</ReactMarkdown>
            </Suspense>
          </div>
        )}
      </ScrollArea>
    </article>
  );
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
