import { journalSections } from "../../JournalAllCollection";
import { AccountCollectionFilters as CollectionFilters } from "@/features/settings/AccountCollectionFilters";
import { useState, type ComponentProps } from "react";
import { useNavigate } from "react-router-dom";
import type { SpaceDrawing } from "../types";
import { useSpaceItemCreator } from "@/features/spaces/useSpaceItemCreator";
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
} from "@/shared/ui";
import { MoreHorizontal, Pencil, PencilRuler, Pin, PinOff, Plus, Trash2 } from "lucide-react";

export function DrawingCollection(props: {
  spaceId: string;
  readOnly?: boolean;
  drawings: SpaceDrawing[];
  query: string;
  onQuery: (value: string) => void;
  pinnedIds: Set<string>;
  onPin: (id: string) => void;
  onOpen: (drawing: SpaceDrawing) => void;
  onCreate: () => void;
  onRename: (drawing: SpaceDrawing) => void;
  onDelete: (drawing: SpaceDrawing) => void;
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
  const drawings = refinement.items;
  return (
    <CollectionPage>
      <CollectionHeading
        title="Journal"
        actions={
          <>
            <CollectionSearch
              aria-label="Search drawings"
              placeholder="Search drawings"
              value={props.query}
              onChange={(e) => props.onQuery(e.target.value)}
            />
            <Button variant="primary" className="px-4" onClick={props.onCreate}>
              <Plus />
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
          fields={["Access", "Pinned", "Created"]}
          sortResetKey={refinement.sortKey}
          categoryLabel="Type"
          view={view}
          items={drawings.map((d) => ({
            id: d.id,
            title: d.title || "Untitled drawing",
            icon: <PencilRuler size={18} />,
            category: "Drawing",
            creator: creatorName(d.creator_user_id),
            metadata: {
              Access: props.readOnly || d.role === "viewer" ? "View only" : "Can edit",
              Pinned: props.pinnedIds.has(d.id) ? "Yes" : "No",
              Created: new Date(d.created_at).toLocaleDateString(),
            },
            sortValues: { Created: Date.parse(d.created_at) },
            updatedAt: d.updated_at,
            updated: new Date(d.updated_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            }),
            onOpen: () => props.onOpen(d),
            marker: props.pinnedIds.has(d.id) ? <Pin size={13} aria-label="Pinned" /> : undefined,
            contextMenu: <DrawingActions drawing={d} props={props} context />,
            actions: (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <IconButton label={`More actions for ${d.title || "Untitled drawing"}`}>
                    <MoreHorizontal />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DrawingActions drawing={d} props={props} />
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          }))}
        />
      }
    </CollectionPage>
  );
}

function DrawingActions({
  drawing,
  props,
  context = false,
}: {
  drawing: SpaceDrawing;
  props: ComponentProps<typeof DrawingCollection>;
  context?: boolean;
}) {
  const Action = context ? ContextMenuAction : MenuItem;
  return (
    <>
      <Action
        icon={props.pinnedIds.has(drawing.id) ? <PinOff /> : <Pin />}
        label={props.pinnedIds.has(drawing.id) ? "Unpin" : "Pin"}
        onSelect={() => props.onPin(drawing.id)}
      />
      <Action
        icon={<Pencil />}
        label="Rename"
        disabled={props.readOnly || drawing.role === "viewer"}
        title={
          props.readOnly || drawing.role === "viewer"
            ? "You have view-only access to this drawing."
            : undefined
        }
        onSelect={() => props.onRename(drawing)}
      />
      <Action
        icon={<Trash2 />}
        destructive
        label="Delete"
        disabled={props.readOnly || !drawing.can_delete}
        title={
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
