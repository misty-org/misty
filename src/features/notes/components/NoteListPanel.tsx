import type {
  NoteListItemProps,
  NoteListPanelProps,
} from "@/models/interfaces/features/notes/components/NoteListPanel";
export type {
  NoteListItemProps,
  NoteListPanelProps,
} from "@/models/interfaces/features/notes/components/NoteListPanel";
import { FileText, Plus, SearchX, Star } from "lucide-react";
import { Button, EmptyState, ScrollArea, Skeleton, cn } from "@/ui";
import { noteGroupById, relativeTime } from "@/features/notes/noteFilters";
import { NoteSourceBadge, NoteSyncIndicator } from "./NoteSourceBadge";
import { NotionConnectCard, SyncErrorNotice } from "./NotesConnectionCards";

const listPanelClass =
  "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] border-r border-border bg-background";

const listHeaderClass =
  "flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3";

const rowClass =
  "block w-full cursor-pointer border-b border-border/60 px-3 py-2.5 text-left transition-colors hover:bg-muted/50";

const rowSelectedClass = "bg-muted/80 shadow-[inset_2px_0_0_var(--primary)] hover:bg-muted/80";

export function NoteListPanel(props: NoteListPanelProps) {
  const group = noteGroupById(props.activeGroup);
  const notionStatus = props.notionConnector?.status();
  const showNotionCard =
    props.activeGroup === "notion" && notionStatus !== undefined && notionStatus !== "connected";

  return (
    <section className={listPanelClass} aria-label="Note list">
      <div className={listHeaderClass}>
        <h2 className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {group.label}
        </h2>
        <span className="text-[11px] tabular-nums text-muted-foreground/70">
          {props.notes.length}
        </span>
      </div>

      <ScrollArea className="min-h-0">
        {Object.entries(props.connectorErrors).map(([connectorId, message]) => (
          <SyncErrorNotice key={connectorId} message={message} />
        ))}

        {props.loading ? <NoteListSkeleton /> : null}

        {!props.loading && showNotionCard ? (
          <div className="p-3">
            <NotionConnectCard
              status={notionStatus}
              busy={false}
              onConnect={props.onConnectNotion}
            />
          </div>
        ) : null}

        {!props.loading && !showNotionCard && props.notes.length === 0 ? (
          props.query ? (
            <EmptyState
              compact
              icon={<SearchX />}
              title="No matching notes"
              description={`Nothing matches “${props.query}” in ${group.label}.`}
              action={
                <Button type="button" variant="secondary" size="sm" onClick={props.onClearQuery}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <EmptyState
              compact
              icon={<FileText />}
              title={
                props.activeGroup === "space"
                  ? `No notes in ${props.spaceName} yet`
                  : "No notes here yet"
              }
              description={
                props.activeGroup === "space"
                  ? "Write a note in this Space, or file an existing one from Unlinked."
                  : "Write a native Misty note, or connect a source to bring existing pages in."
              }
              action={
                <Button type="button" size="sm" className="gap-1.5" onClick={props.onNewNote}>
                  <Plus size={14} strokeWidth={2.2} />
                  New note
                </Button>
              }
            />
          )
        ) : null}

        {!props.loading
          ? props.notes.map((note) => (
              <NoteListItem
                key={note.id}
                note={note}
                selected={note.id === props.selectedNoteId}
                onSelect={() => props.onSelectNote(note.id)}
              />
            ))
          : null}
      </ScrollArea>
    </section>
  );
}

function NoteListItem(props: NoteListItemProps) {
  const { note } = props;

  return (
    <Button
      type="button"
      variant="ghost"
      aria-current={props.selected ? "true" : undefined}
      className={cn(
        rowClass,
        "h-auto rounded-none font-normal",
        props.selected && rowSelectedClass,
      )}
      onClick={props.onSelect}
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
            {note.title}
          </span>
          {note.favorite ? (
            <Star size={12} className="shrink-0 fill-amber-500 text-amber-500" />
          ) : null}
          <NoteSyncIndicator compact status={note.syncStatus} />
        </span>

        <span className="line-clamp-2 text-[12px] leading-[1.45] text-muted-foreground">
          {note.preview}
        </span>

        <span className="flex min-w-0 items-center gap-1.5 pt-0.5">
          <NoteSourceBadge source={note.source} />
          {note.spaceName ? (
            <span className="truncate text-[11px] text-muted-foreground/80">{note.spaceName}</span>
          ) : (
            <span className="text-[11px] italic text-muted-foreground/50">Unlinked</span>
          )}
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground/60">
            {relativeTime(note.updatedAt)}
          </span>
        </span>
      </span>
    </Button>
  );
}

function NoteListSkeleton() {
  return (
    <div aria-hidden="true">
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="space-y-2 border-b border-border/60 px-3 py-3">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}
