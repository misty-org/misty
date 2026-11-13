import { journalSections } from "../../JournalAllCollection";
import { OrderedCollectionFilters as CollectionFilters } from "@/features/settings/OrderedCollectionFilters";
import { useState, type ComponentProps } from "react";
import { useNavigate } from "react-router-dom";
import type { SpaceDrawing } from "../drawingTypes";
import { useSpaceItemCreator } from "../../../overview/useSpaceItemCreator";
import {
  Button,
  CollectionPage,
  CollectionHeading,
  CollectionSearch,
  useCollectionRefinement,
  CollectionItems,
  CollectionViewToggle,
  MenuItem,
  itemTones,
  useNotice,
} from "@/shared/ui";
import { useRangeSelection } from "@/shared/hooks/useRangeSelection";
import { Pencil, PencilRuler, Plus, Trash2 } from "lucide-react";

export function DrawingCollection(props: {
  spaceId: string;
  readOnly?: boolean;
  drawings: SpaceDrawing[];
  query: string;
  onQuery: (value: string) => void;
  onOpen: (drawing: SpaceDrawing) => void;
  onCreate: () => void;
  onRename: (drawing: SpaceDrawing) => void;
  onDelete: (drawing: SpaceDrawing) => void;
  onDeleteMany: (ids: string[]) => void;
  bulkBusy?: boolean;
  bulkError?: string;
}) {
  const navigate = useNavigate();
  const creatorName = useSpaceItemCreator(props.spaceId);
  const filter = "drawings";
  const [view, setView] = useState<"grid" | "list">("list");
  const refinement = useCollectionRefinement(props.drawings, {
    label: "Filter drawings",
    title: (drawing) => drawing.title || "Untitled drawing",
    date: (drawing) => drawing.updated_at,
    facet: {
      label: "Access",
      options: [
        { value: "all", label: "All drawings" },
        { value: "editable", label: "Can edit" },
        { value: "viewer", label: "View only" },
      ],
      value: (drawing) => (props.readOnly || drawing.role === "viewer" ? "viewer" : "editable"),
    },
  });
  useNotice(Boolean(props.bulkError), { message: props.bulkError ?? "", tone: "error" });
  const drawings = refinement.items;
  const selection = useRangeSelection(
    drawings
      .filter((drawing) => !props.readOnly && drawing.can_delete)
      .map((drawing) => drawing.id),
  );
  return (
    <CollectionPage>
      <CollectionHeading
        title="Docs"
        end={
          <>
            <CollectionSearch
              aria-label="Search drawings"
              placeholder="Search drawings"
              value={props.query}
              onChange={(e) => props.onQuery(e.target.value)}
            />
            <Button variant="primary" icon={Plus} onClick={props.onCreate}>
              New drawing
            </Button>
          </>
        }
      />
      <CollectionFilters
        collectionId="journal"
        options={journalSections}
        value={filter}
        onChange={(value) => {
          if (value !== "drawings")
            navigate(
              `/spaces/${encodeURIComponent(props.spaceId)}/notes${value === "all" ? "" : `?section=${value}`}`,
            );
        }}
        filterControl={refinement.control}
        actions={
          <CollectionViewToggle value={view} onChange={setView} disabled={!drawings.length} />
        }
      />
      {
        <CollectionItems
          columnSetId="drawings"
          fields={["Access", "Created"]}
          sortResetKey={refinement.sortKey}
          categoryLabel="Type"
          view={view}
          listIcons
          items={drawings.map((d) => ({
            id: d.id,
            title: d.title || "Untitled drawing",
            icon: <PencilRuler size={18} />,
            tone: itemTones.drawing,
            category: "Drawing",
            creator: creatorName(d.creator_user_id),
            metadata: {
              Access: props.readOnly || d.role === "viewer" ? "View only" : "Can edit",
              Created: new Date(d.created_at).toLocaleDateString(),
            },
            sortValues: { Created: Date.parse(d.created_at) },
            updatedAt: d.updated_at,
            updated: new Date(d.updated_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            }),
            onOpen: () => props.onOpen(d),
            selectable: !props.readOnly && d.can_delete,
            menu:
              selection.menuTargets(d.id).length > 1 ? (
                <MenuItem
                  icon={<Trash2 />}
                  label={`Delete ${selection.selectedIds.length} drawings`}
                  danger
                  disabled={props.bulkBusy}
                  onSelect={() => props.onDeleteMany(selection.selectedIds)}
                />
              ) : (
                <DrawingActions drawing={d} props={props} />
              ),
            menuLabel: `More actions for ${d.title || "Untitled drawing"}`,
            onMenuOpen: () => selection.pickForMenu(d.id),
          }))}
          selectedIds={selection.selectedIds}
          onSelect={selection.select}
        />
      }
    </CollectionPage>
  );
}

function DrawingActions({
  drawing,
  props,
}: {
  drawing: SpaceDrawing;
  props: ComponentProps<typeof DrawingCollection>;
}) {
  return (
    <>
      <MenuItem
        icon={<Pencil />}
        label="Rename"
        disabled={props.readOnly || drawing.role === "viewer"}
        reason={
          props.readOnly || drawing.role === "viewer"
            ? "You have view-only access to this drawing."
            : undefined
        }
        onSelect={() => props.onRename(drawing)}
      />
      <MenuItem
        icon={<Trash2 />}
        danger
        label="Delete"
        disabled={props.readOnly || !drawing.can_delete}
        reason={
          props.readOnly
            ? "This Space is read-only."
            : !drawing.can_delete
              ? "Only the creator or Space owner can delete this drawing."
              : undefined
        }
        onSelect={() => props.onDelete(drawing)}
      />
    </>
  );
}
