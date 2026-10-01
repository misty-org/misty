import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, PencilRuler, Plus } from "lucide-react";
import { useAuth } from "@/features/auth";
import { useSpacesStore } from "@/features/spaces/core";
import { useSpaceOverview } from "@/features/spaces/useSpaceOverview";
import { useSpaceOverviewActions } from "@/features/spaces/useSpaceOverviewActions";
import { useSpaceItemCreator } from "@/features/spaces/useSpaceItemCreator";
import { AccountCollectionFilters } from "@/features/settings/AccountCollectionFilters";
import {
  Button,
  CollectionPage,
  CollectionHeading,
  CollectionSearch,
  CollectionItems,
  CollectionViewToggle,
  Spinner,
  useCollectionRefinement,
} from "@/shared/ui";

export const journalSections = [
  { value: "all", label: "All" },
  { value: "notes", label: "Notes" },
  { value: "drawings", label: "Drawings" },
  { value: "pinned", label: "Pinned" },
];

export function JournalAllCollection(props: {
  spaceId: string;
  section: "all" | "pinned";
  query: string;
  onQueryChange: (query: string) => void;
  onSection: (section: string) => void;
  readOnly: boolean;
  onCreate: () => void;
  pinnedIds: Set<string>;
  onTogglePin: (id: string) => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const space = useSpacesStore((state) => state.spaces.find((space) => space.id === props.spaceId));
  const data = useSpaceOverview(user?.id ?? "", space ?? { id: props.spaceId }, "Journal");
  const journal = data.items.filter((item) => item.area === "Journal");
  const actions = useSpaceOverviewActions(user?.id ?? "", props.spaceId, journal, data.retry, {
    pinnedIdSet: props.pinnedIds,
    togglePinned: props.onTogglePin,
  });
  const creator = useSpaceItemCreator(props.spaceId);
  const [view, setView] = useState<"list" | "grid">("list");
  const refinement = useCollectionRefinement(
    journal.filter(
      (item) =>
        (props.section !== "pinned" || actions.isPinned(item)) &&
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
            {!props.readOnly && (
              <Button variant="primary" className="px-4" onClick={props.onCreate}>
                <Plus />
                New note
              </Button>
            )}
          </>
        }
      />
      <AccountCollectionFilters
        collectionId="journal"
        options={journalSections}
        value={props.section}
        onChange={props.onSection}
        filterControl={refinement.control}
        actions={<CollectionViewToggle value={view} onChange={setView} />}
      />
      {data.failed && (
        <div role="alert" className="flex items-center gap-3 text-sm text-cream-muted">
          Some items couldn’t load.
          <Button variant="ghost" size="sm" onClick={data.retry}>
            Retry
          </Button>
        </div>
      )}
      {actions.error && (
        <p role="alert" className="text-sm text-cream-muted">
          {actions.error}
        </p>
      )}
      {actions.dialog}
      {data.loading ? (
        <Spinner label="Loading journal" />
      ) : (
        <CollectionItems
          columnSetId="journal-all"
          fields={["Access", "Pinned", "Created"]}
          view={view}
          sortResetKey={refinement.sortKey}
          categoryLabel="Type"
          items={refinement.items.map((item) => ({
            ...item,
            ...actions.forItem(item),
            icon: item.kind === "note" ? <FileText /> : <PencilRuler />,
            category: item.kind === "note" ? "Note" : "Drawing",
            creator: creator(item.creatorUserId),
            metadata: {
              Access:
                props.readOnly || !(item.rename || item.renameRoute) ? "View only" : "Can edit",
              Pinned: actions.isPinned(item) ? "Yes" : "No",
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
        />
      )}
    </CollectionPage>
  );
}
