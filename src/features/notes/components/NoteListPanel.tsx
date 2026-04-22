import type {
  NoteListItemProps,
  NoteListPanelProps,
} from "@/models/interfaces/features/notes/components/NoteListPanel";
export type {
  NoteListItemProps,
  NoteListPanelProps,
} from "@/models/interfaces/features/notes/components/NoteListPanel";
import { Star } from "lucide-react";
import { Button, EmptyState, ScrollArea, Skeleton, cn } from "@/ui";
import { relativeTime } from "@/features/notes/noteFilters";
import { SyncErrorNotice } from "./NotesConnectionCards";

const listPanelClass = "grid h-full min-h-[200px] overflow-hidden";

const listHeaderClass = "flex h-9 shrink-0 items-center justify-between gap-2 px-2";

const rowClass =
  "misty-hover-marker-side relative block w-full cursor-pointer rounded-md px-3 py-2.5 text-left transition-colors";

const rowSelectedClass = "misty-active-marker-side text-sidebar-accent-foreground";

export function NoteListPanel(props: NoteListPanelProps) {
  const showHeader = props.showHeader !== false;
  return (
    <section
      className={`${listPanelClass} ${
        showHeader ? "grid-rows-[auto_minmax(0,1fr)]" : "grid-rows-[minmax(0,1fr)]"
      }`}
      aria-label="Note list"
    >
      {showHeader ? (
        <div className={listHeaderClass}>
          <h2 className="truncate text-sm font-semibold text-muted-foreground">
            {props.spaceName}
          </h2>
          <span className="text-[11px] tabular-nums text-muted-foreground/70">
            {props.notes.length}
          </span>
        </div>
      ) : null}

      <ScrollArea className="min-h-0">
        {Object.entries(props.connectorErrors).map(([connectorId, message]) => (
          <SyncErrorNotice key={connectorId} message={message} />
        ))}

        {props.loading ? <NoteListSkeleton /> : null}

        {!props.loading && props.notes.length === 0 ? (
          props.query ? (
            <EmptyState
              compact
              title="No matching notes"
              description={`Nothing matches “${props.query}” in ${props.spaceName}.`}
              action={
                <Button type="button" variant="secondary" size="sm" onClick={props.onClearQuery}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <p className="m-0 px-2 py-1 text-[11px] text-muted-foreground">None yet</p>
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
      className={cn(rowClass, "h-auto font-normal", props.selected && rowSelectedClass)}
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
        </span>

        <span className="line-clamp-2 text-[12px] leading-[1.45] text-muted-foreground">
          {note.preview}
        </span>

        <span className="text-[11px] tabular-nums text-muted-foreground/60">
          {relativeTime(note.updatedAt)}
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
