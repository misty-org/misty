import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  EmptyState,
  ScrollArea,
  Skeleton,
  cn,
} from "@/shared/ui";
import { Archive, Pencil, Trash2 } from "lucide-react";
import type { UnifiedNote } from "../model/types/types";
import { SyncErrorNotice } from "./NotesConnectionCards";

const listPanelClass = "flex flex-col min-h-0 overflow-hidden";

const listHeaderClass = "flex h-9 shrink-0 items-center justify-between gap-2 px-2";

const rowClass =
  "misty-marker-host relative block w-full cursor-pointer rounded-md px-3 py-2.5 text-left transition-colors";

const rowSelectedClass = "misty-active-marker-side text-cream-bright";

export function NoteListPanel(props: NoteListPanelProps) {
  const showHeader = props.showHeader !== false;
  return (
    <section className={listPanelClass} aria-label="Note list">
      {showHeader ? (
        <div className={listHeaderClass}>
          <h2 className="truncate text-sm font-semibold text-cream-muted">{props.spaceName}</h2>
          <span className="text-[11px] tabular-nums text-cream-muted/70">{props.notes.length}</span>
        </div>
      ) : null}

      <ScrollArea className="-mx-3 min-h-0 px-3">
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
            <p className="m-0 px-2 py-1 text-[11px] text-cream-muted">None yet</p>
          )
        ) : null}

        {!props.loading
          ? props.notes.map((note) => (
              <NoteListItem
                key={note.id}
                note={note}
                selected={note.id === props.selectedNoteId}
                onSelect={() => props.onSelectNote(note.id)}
                onRename={
                  props.onRenameNote && note.source === "misty"
                    ? () => props.onRenameNote?.(note)
                    : undefined
                }
                onArchive={
                  props.onArchiveNote && note.source === "misty" && note.canDelete
                    ? () => props.onArchiveNote?.(note)
                    : undefined
                }
                onDelete={
                  props.onDeleteNote && note.canDelete
                    ? () => props.onDeleteNote?.(note)
                    : undefined
                }
              />
            ))
          : null}
      </ScrollArea>
    </section>
  );
}

function NoteListItem(props: NoteListItemProps) {
  const { note } = props;

  const row = (
    <Button
      type="button"
      variant="ghost"
      aria-current={props.selected ? "true" : undefined}
      className={cn(rowClass, "h-auto font-normal", props.selected && rowSelectedClass)}
      onClick={props.onSelect}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-cream">
          {note.title}
        </span>
      </span>
    </Button>
  );
  if (!props.onRename && !props.onArchive && !props.onDelete) return row;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem disabled={!props.onRename} onSelect={props.onRename}>
          <Pencil />
          Rename
        </ContextMenuItem>
        <ContextMenuItem disabled={!props.onArchive} onSelect={props.onArchive}>
          <Archive />
          Archive
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!props.onDelete}
          className="text-red-300"
          onSelect={props.onDelete}
        >
          <Trash2 />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function NoteListSkeleton() {
  // Same row height as a real (now single-line) note row, so the list
  // doesn't jump once loading finishes.
  return (
    <div aria-hidden="true" className="grid gap-0.5">
      {[0, 1, 2].map((row) => (
        <div key={row} className={rowClass}>
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export interface NoteListPanelProps {
  notes: UnifiedNote[];
  query: string;
  loading: boolean;
  spaceName: string;
  selectedNoteId?: string;
  showHeader?: boolean;
  connectorErrors: Record<string, string>;
  onSelectNote: (noteId: string) => void;
  onNewNote: () => void;
  onClearQuery: () => void;
  onRenameNote?: (note: UnifiedNote) => void;
  onArchiveNote?: (note: UnifiedNote) => void;
  onDeleteNote?: (note: UnifiedNote) => void;
}

export interface NoteListItemProps {
  note: UnifiedNote;
  selected: boolean;
  onSelect: () => void;
  onRename?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
}
