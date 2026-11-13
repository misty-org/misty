import { OrderedCollectionFilters as CollectionFilters } from "@/features/settings/OrderedCollectionFilters";
import { useState, type ComponentProps } from "react";
import { JournalAllCollection, journalSections } from "../../JournalAllCollection";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Button,
  CollectionPage,
  CollectionHeading,
  CollectionSearch,
  useCollectionRefinement,
  CollectionItems,
  CollectionViewToggle,
  MenuItem,
  CollectionSkeleton,
  itemTones,
  useNotice,
} from "@/shared/ui";
import { useRangeSelection } from "@/shared/hooks/useRangeSelection";
import type { UnifiedNote } from "../noteTypes";
import { useSpaceItemCreator } from "../../../overview/useSpaceItemCreator";

export function JournalCollection(props: {
  spaceId: string;
  notes: UnifiedNote[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  readOnly: boolean;
  onCreate: () => void;
  onOpen: (note: UnifiedNote) => void;
  onRename: (note: UnifiedNote) => void;
  onDelete: (note: UnifiedNote) => void;
  onDeleteMany?: (ids: string[]) => void;
  bulkError?: string;
}) {
  const navigate = useNavigate();
  const creatorName = useSpaceItemCreator(props.spaceId);
  const [params, setParams] = useSearchParams();
  const section = params.get("section");
  const filter = section === "notes" ? section : "all";
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
  const refinement = useCollectionRefinement(props.notes, {
    label: "Filter docs",
    title: (note) => note.title || "Untitled doc",
    date: (note) => note.updatedAt,
    facet: {
      label: "Access",
      options: [
        { value: "all", label: "All docs" },
        { value: "editable", label: "Can edit" },
        { value: "viewer", label: "View only" },
      ],
      value: (note) => (props.readOnly || note.role === "viewer" ? "viewer" : "editable"),
    },
  });
  useNotice(filter !== "all" && Boolean(props.bulkError), {
    message: props.bulkError ?? "",
    tone: "error",
  });
  useNotice(filter !== "all" && props.error, {
    message: "Docs couldn’t load.",
    tone: "error",
    action: { label: "Retry", onSelect: props.onRetry },
  });
  const notes = refinement.items;
  const selectableIds = notes
    .filter((note) => !props.readOnly && note.canDelete)
    .map((note) => note.id);
  const selection = useRangeSelection(selectableIds);
  if (filter === "all")
    return <JournalAllCollection {...props} section={filter} onSection={selectSection} />;
  return (
    <CollectionPage>
      <CollectionHeading
        title="Docs"
        end={
          <>
            <CollectionSearch
              aria-label="Search docs"
              placeholder="Search journal"
              value={props.query}
              onChange={(event) => props.onQueryChange(event.target.value)}
            />
            {!props.readOnly && (
              <Button variant="primary" icon={Plus} onClick={props.onCreate}>
                New doc
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
      {props.loading ? (
        <CollectionSkeleton label="Loading docs" view={view} />
      ) : (
        <CollectionItems
          columnSetId="notes"
          fields={["Access", "Tags", "Links", "Created"]}
          sortResetKey={refinement.sortKey}
          categoryLabel="Type"
          view={view}
          listIcons
          items={notes.map((note) => ({
            id: note.id,
            title: note.title || "Untitled doc",
            icon: <FileText size={18} />,
            tone: itemTones.note,
            category: "Doc",
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
            selectable: !props.readOnly && note.canDelete,
            menu:
              selection.menuTargets(note.id).length > 1 ? (
                <MenuItem
                  icon={<Trash2 />}
                  label={`Delete ${selection.selectedIds.length} docs`}
                  danger
                  onSelect={() => props.onDeleteMany?.(selection.selectedIds)}
                />
              ) : (
                <NoteActions note={note} props={props} />
              ),
            menuLabel: `More actions for ${note.title || "Untitled doc"}`,
            onMenuOpen: () => selection.pickForMenu(note.id),
          }))}
          selectedIds={selection.selectedIds}
          onSelect={selection.select}
        />
      )}
    </CollectionPage>
  );
}

function NoteActions({
  note,
  props,
}: {
  note: UnifiedNote;
  props: ComponentProps<typeof JournalCollection>;
}) {
  return (
    <>
      <MenuItem
        icon={<Pencil />}
        label="Rename"
        disabled={props.readOnly || note.role === "viewer"}
        reason={
          props.readOnly || note.role === "viewer"
            ? "You have view-only access to this doc."
            : undefined
        }
        onSelect={() => props.onRename(note)}
      />
      <MenuItem
        icon={<Trash2 />}
        label="Delete"
        danger
        disabled={props.readOnly || !note.canDelete}
        reason={
          props.readOnly
            ? "This Space is read-only."
            : !note.canDelete
              ? "Only the creator or Space owner can delete this doc."
              : undefined
        }
        onSelect={() => props.onDelete(note)}
      />
    </>
  );
}
