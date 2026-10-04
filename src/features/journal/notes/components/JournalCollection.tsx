import { AccountCollectionFilters as CollectionFilters } from "@/features/settings/AccountCollectionFilters";
import { useState, type ComponentProps } from "react";
import { JournalAllCollection, journalSections } from "../../JournalAllCollection";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileText, MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import {
  Button,
  CollectionPage,
  CollectionHeading,
  CollectionSearch,
  useCollectionRefinement,
  CollectionItems,
  CollectionViewToggle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuItem,
  ContextMenuAction,
  IconButton,
  CollectionSkeleton,
  itemTones,
} from "@/shared/ui";
import type { UnifiedNote } from "../model/types/types";
import { useSpaceItemCreator } from "@/features/spaces/useSpaceItemCreator";

export function JournalCollection(props: {
  spaceId: string;
  notes: UnifiedNote[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  pinnedIds: Set<string>;
  readOnly: boolean;
  onCreate: () => void;
  onOpen: (note: UnifiedNote) => void;
  onRename: (note: UnifiedNote) => void;
  onTogglePin: (id: string) => void;
  onDelete: (note: UnifiedNote) => void;
}) {
  const navigate = useNavigate();
  const creatorName = useSpaceItemCreator(props.spaceId);
  const [params, setParams] = useSearchParams();
  const filter =
    params.get("section") === "notes"
      ? "notes"
      : params.get("section") === "pinned"
        ? "pinned"
        : "all";
  const selectSection = (value: string) => {
    if (value === "drawings") navigate(`/spaces/${encodeURIComponent(props.spaceId)}/drawings`);
    else {
      const next = new URLSearchParams(params);
      next.delete("note");
      next.delete("view");
      if (value === "all") next.delete("section");
      else next.set("section", value);
      setParams(next);
    }
  };
  const [view, setView] = useState<"list" | "grid">("list");
  const refinement = useCollectionRefinement(
    props.notes.filter((note) => filter !== "pinned" || props.pinnedIds.has(note.id)),
    {
      label: "Filter notes",
      title: (note) => note.title || "Untitled note",
      date: (note) => note.updatedAt,
      facet: {
        label: "Access",
        options: [
          { value: "all", label: "All notes" },
          { value: "editable", label: "Can edit" },
          { value: "viewer", label: "View only" },
        ],
        value: (note) => (props.readOnly || note.role === "viewer" ? "viewer" : "editable"),
      },
    },
  );
  const notes = refinement.items;
  if (filter === "all" || filter === "pinned")
    return <JournalAllCollection {...props} section={filter} onSection={selectSection} />;
  return (
    <CollectionPage>
      <CollectionHeading
        title="Journal"
        actions={
          <>
            <CollectionSearch
              aria-label="Search notes"
              placeholder="Search journal"
              value={props.query}
              onChange={(event) => props.onQueryChange(event.target.value)}
            />
            {!props.readOnly && (
              <Button variant="primary" className="px-4" onClick={props.onCreate}>
                <Plus />
                New note
              </Button>
            )}
          </>
        }
      />
      <CollectionFilters
        collectionId="journal"
        options={journalSections}
        value={filter}
        onChange={selectSection}
        filterControl={refinement.control}
        actions={<CollectionViewToggle value={view} onChange={setView} disabled={!notes.length} />}
      />
      {props.error && (
        <div className="flex items-center gap-3 text-sm text-cream-muted" role="alert">
          Notes couldn’t load.
          <Button variant="ghost" size="sm" onClick={props.onRetry}>
            Retry
          </Button>
        </div>
      )}
      {props.loading ? (
        <CollectionSkeleton label="Loading notes" view={view} />
      ) : (
        <CollectionItems
          columnSetId="notes"
          fields={["Access", "Tags", "Links", "Created"]}
          sortResetKey={refinement.sortKey}
          categoryLabel="Type"
          view={view}
          items={notes.map((note) => ({
            id: note.id,
            title: note.title || "Untitled note",
            icon: <FileText size={18} />,
            tone: itemTones.note,
            category: "Note",
            creator: creatorName(note.creatorUserId),
            metadata: {
              Access: props.readOnly || note.role === "viewer" ? "View only" : "Can edit",
              Tags: note.tags?.join(", ") || "—",
              Links: note.backlinkCount ?? note.backlinks?.length ?? 0,
              Created: note.createdAt ? new Date(note.createdAt).toLocaleDateString() : "—",
            },
            sortValues: { Created: Date.parse(note.createdAt) },
            updatedAt: note.updatedAt,
            updated: new Date(note.updatedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            }),
            onOpen: () => props.onOpen(note),
            marker: props.pinnedIds.has(note.id) ? (
              <Pin size={13} className="text-cream-muted" aria-label="Pinned" />
            ) : undefined,
            contextMenu: <NoteActions note={note} props={props} context />,
            actions: (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label={`More actions for ${note.title || "Untitled note"}`}>
                    <MoreHorizontal />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <NoteActions note={note} props={props} />
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          }))}
        />
      )}
    </CollectionPage>
  );
}

function NoteActions({
  note,
  props,
  context = false,
}: {
  note: UnifiedNote;
  props: ComponentProps<typeof JournalCollection>;
  context?: boolean;
}) {
  const Action = context ? ContextMenuAction : MenuItem;
  return (
    <>
      <Action
        icon={props.pinnedIds.has(note.id) ? <PinOff /> : <Pin />}
        label={props.pinnedIds.has(note.id) ? "Unpin" : "Pin"}
        onSelect={() => props.onTogglePin(note.id)}
      />
      <Action
        icon={<Pencil />}
        label="Rename"
        disabled={props.readOnly || note.role === "viewer"}
        title={
          props.readOnly || note.role === "viewer"
            ? "You have view-only access to this note."
            : undefined
        }
        onSelect={() => props.onRename(note)}
      />
      <Action
        icon={<Trash2 />}
        label="Delete"
        destructive
        disabled={props.readOnly || !note.canDelete}
        title={
          props.readOnly
            ? "This Space is read-only."
            : !note.canDelete
              ? "Only the creator or Space owner can delete this note."
              : undefined
        }
        onSelect={() => props.onDelete(note)}
      />
    </>
  );
}
