import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, PencilRuler, Plus } from "lucide-react";
import { useAuth } from "@/features/account";
import { CaptureMenu } from "@/features/voice";
import { useSpacesStore } from "@/features/spaces/core";
import { useSpaceOverview } from "../overview/useSpaceOverview";
import { useSpaceOverviewActions } from "../overview/useSpaceOverviewActions";
import { useSpaceItemCreator } from "../overview/useSpaceItemCreator";
import { OrderedCollectionFilters } from "@/features/settings/OrderedCollectionFilters";
import {
  Button,
  CollectionPage,
  CollectionHeading,
  CollectionSearch,
  CollectionItems,
  CollectionViewToggle,
  CollectionSkeleton,
  ErrorNotification,
  useCollectionRefinement,
  itemTones,
  CollectionSelectionBar,
} from "@/shared/ui";
import { useRangeSelection } from "@/shared/hooks/useRangeSelection";
import { confirmAction } from "@/shared/lib/confirmAction";
import { closeDrawingCollaborationSession } from ".";

export const journalSections = [
  { value: "all", label: "All" },
  { value: "notes", label: "Notes" },
  { value: "drawings", label: "Drawings" },
  // A day of Memory: what you read, said and recorded.
  { value: "day", label: "Day" },
];

export function JournalAllCollection(props: {
  spaceId: string;
  section: "all";
  query: string;
  onQueryChange: (query: string) => void;
  onSection: (section: string) => void;
  readOnly: boolean;
  onCreate: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const space = useSpacesStore((state) => state.spaces.find((space) => space.id === props.spaceId));
  const data = useSpaceOverview(user?.id ?? "", space ?? { id: props.spaceId }, "Journal");
  const journal = data.items.filter((item) => item.area === "Journal");
  const actions = useSpaceOverviewActions(user?.id ?? "", props.spaceId, journal, data.retry);
  const creator = useSpaceItemCreator(props.spaceId);
  const [view, setView] = useState<"list" | "grid">("list");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const refinement = useCollectionRefinement(
    journal.filter((item) =>
      item.title.toLocaleLowerCase().includes(props.query.trim().toLocaleLowerCase()),
    ),
    {
      label: "Filter journal",
      title: (item) => item.title,
      date: (item) => item.updatedAt,
      facet: {
        label: "Access",
        value: (item) =>
          props.readOnly || !(item.rename || item.renameRoute) ? "viewer" : "editable",
        options: [
          { value: "all", label: "All items" },
          { value: "editable", label: "Can edit" },
          { value: "viewer", label: "View only" },
        ],
      },
    },
  );
  const selectable = refinement.items.filter((item) => !props.readOnly && item.remove);
  const selection = useRangeSelection(selectable.map((item) => item.id));
  const deleteSelected = async () => {
    if (bulkBusy || !selection.selectedIds.length) return;
    const selected = selection.selectedIds
      .map((id) => journal.find((item) => item.id === id))
      .filter((item) => item?.remove);
    if (!selected.length) return;
    if (
      !(await confirmAction(
        `Permanently delete ${selected.length} selected ${selected.length === 1 ? "item" : "items"}?`,
      ))
    )
      return;
    setBulkBusy(true);
    setBulkError("");
    try {
      for (const item of selected) {
        await item!.remove!();
        if (item!.kind === "drawing")
          closeDrawingCollaborationSession(props.spaceId, item!.id.slice(8));
        window.dispatchEvent(
          new CustomEvent(`misty:space-${item!.kind}-event`, {
            detail: { space_id: props.spaceId },
          }),
        );
      }
      selection.clear();
      data.retry();
    } catch {
      setBulkError("Some selected items couldn't be deleted. Refresh and try again.");
      data.retry();
    } finally {
      setBulkBusy(false);
    }
  };
  return (
    <CollectionPage>
      <CollectionHeading
        title="Journal"
        actions={
          <>
            <CollectionSearch
              aria-label="Search journal"
              placeholder="Search journal"
              value={props.query}
              onChange={(event) => props.onQueryChange(event.target.value)}
            />
            {!props.readOnly && <CaptureMenu />}
            {!props.readOnly && (
              <Button variant="primary" className="px-4" onClick={props.onCreate}>
                <Plus />
                New note
              </Button>
            )}
          </>
        }
      />
      <OrderedCollectionFilters
        collectionId="journal"
        options={journalSections}
        value={props.section}
        onChange={props.onSection}
        filterControl={refinement.control}
        actions={<CollectionViewToggle value={view} onChange={setView} />}
      />
      <ErrorNotification message={data.failed ? "Some items couldn’t load." : ""}>
        <Button type="button" variant="ghost" size="sm" onClick={data.retry}>
          Retry
        </Button>
      </ErrorNotification>
      <ErrorNotification message={actions.error} />
      <ErrorNotification message={bulkError} onDismiss={() => setBulkError("")} />
      <CollectionSelectionBar
        count={selection.selectedIds.length}
        busy={bulkBusy}
        onClear={selection.clear}
        onDelete={() => void deleteSelected()}
      />
      {actions.dialog}
      {data.loading ? (
        <CollectionSkeleton label="Loading journal" view={view} />
      ) : (
        <CollectionItems
          columnSetId="journal-all"
          fields={["Access", "Created"]}
          view={view}
          sortResetKey={refinement.sortKey}
          categoryLabel="Type"
          items={refinement.items.map((item) => ({
            ...item,
            ...actions.forItem(item),
            selectable: !props.readOnly && Boolean(item.remove),
            icon: item.kind === "note" ? <FileText /> : <PencilRuler />,
            tone: item.kind === "note" ? itemTones.note : itemTones.drawing,
            category: item.kind === "note" ? "Note" : "Drawing",
            creator: creator(item.creatorUserId),
            metadata: {
              Access:
                props.readOnly || !(item.rename || item.renameRoute) ? "View only" : "Can edit",
              Created: item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "—",
            },
            sortValues: { Created: item.createdAt ? Date.parse(item.createdAt) : undefined },
            updated: item.updatedAt
              ? new Date(item.updatedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })
              : "—",
            onOpen: () => navigate(item.route),
          }))}
          selectedIds={selection.selectedIds}
          onSelect={selection.select}
        />
      )}
    </CollectionPage>
  );
}
