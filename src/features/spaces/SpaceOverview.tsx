import { AccountCollectionFilters as CollectionFilters } from "@/features/settings/AccountCollectionFilters";
import { LibraryItemThumbnail } from "@/features/library";
import { FileNameIcon } from "@/features/file-ui";
import { spacesApi } from "@/api/spaces/api";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import { useAuth } from "@/features/auth";
import { Images, FileText, MessagesSquare, PencilRuler } from "lucide-react";
import {
  appIcons,
  Button,
  CollectionPage,
  CollectionHeading,
  CollectionSearch,
  useCollectionRefinement,
  CollectionItems,
  CollectionViewToggle,
  itemTones,
  CollectionSkeleton,
} from "@/shared/ui";
import { useSpaceOverview } from "./useSpaceOverview";
import { useSpaceItemCreator } from "./useSpaceItemCreator";
import { useSpaceOverviewActions } from "./useSpaceOverviewActions";
import { SpaceCreateMenu } from "./components/SpaceCreateMenu";
import { useSpacePersonalItems } from "./useSpacePersonalItems";
import { useActivityStore } from "@/features/activity/useActivityStore";
import { spaceSuggestions } from "./spaceSuggestions";

const icons = {
  note: FileText,
  drawing: PencilRuler,
  task: appIcons.planner,
  file: Images,
  chat: MessagesSquare,
};
const tones = {
  note: itemTones.note,
  drawing: itemTones.drawing,
  task: itemTones.task,
  file: itemTones.image,
  chat: itemTones.chat,
};
export function SpaceOverview({ space }: { space: Space }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const source = useSpaceOverview(user?.id ?? "", space);
  const personal = useSpacePersonalItems(space.id);
  const activity = useActivityStore((state) => state.attentionItems);
  const data = {
    ...source,
    items: source.items.map((item) => {
      const favorite = personal.items.some((saved) => saved.item_key === item.id && saved.favorite);
      return {
        ...item,
        favorite,
        toggleFavorite: personal.ready
          ? () => personal.update(item.id, { favorite: !favorite })
          : undefined,
      };
    }),
  };
  const suggestions = spaceSuggestions(data.items, activity, user?.id ?? "", space.id);
  const creatorName = useSpaceItemCreator(space.id);
  const itemActions = useSpaceOverviewActions(user?.id ?? "", space.id, data.items, data.retry);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState<"list" | "grid">("list");
  const filtered =
    filter === "suggested"
      ? suggestions.map((s) => ({ ...s.item, route: s.route }))
      : data.items.filter(
          (item) =>
            filter === "all" ||
            (filter === "favorites" ? item.favorite : item.creatorUserId === user?.id),
        );
  const searched = filtered.filter((item) =>
    item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const refinement = useCollectionRefinement(searched, {
    label: "Filter items",
    title: (item) => item.title,
    date: (item) => item.updatedAt,
    defaultOrderLabel: filter === "suggested" ? "Suggested order" : "Last activity",
    facet: {
      label: "Item type",
      value: (item) => item.kind,
      options: [
        { value: "all", label: "All types" },
        { value: "chat", label: "Chats" },
        { value: "task", label: "Tasks" },
        { value: "note", label: "Notes" },
        { value: "drawing", label: "Drawings" },
        { value: "file", label: "Files" },
      ],
    },
  });
  const items = refinement.items;
  return (
    <CollectionPage>
      <CollectionHeading
        title="All"
        actions={
          <>
            <CollectionSearch
              aria-label="Search this space"
              placeholder="Search this space"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <SpaceCreateMenu space={space} />
          </>
        }
      />
      <CollectionFilters
        collectionId="space"
        options={[
          { value: "all", label: "All" },
          { value: "yours", label: "Yours" },
          { value: "suggested", label: "Suggested" },
          { value: "favorites", label: "Favorites" },
        ]}
        value={filter}
        onChange={setFilter}
        filterControl={refinement.control}
        actions={<CollectionViewToggle value={view} onChange={setView} disabled={!items.length} />}
      />
      {data.failed && (
        <div role="alert" className="flex items-center gap-3 text-sm text-cream-muted">
          Some items couldn’t load.
          <Button variant="ghost" size="sm" onClick={data.retry}>
            Retry
          </Button>
        </div>
      )}
      {personal.error && (
        <p role="alert" className="text-sm text-cream-muted">
          {personal.error}
          <Button variant="ghost" size="sm" onClick={personal.retry}>
            Retry
          </Button>
        </p>
      )}
      {itemActions.error && (
        <p role="alert" className="text-sm text-cream-muted">
          {itemActions.error}
        </p>
      )}
      {itemActions.dialog}
      {data.loading || (filter === "favorites" && !personal.ready && !personal.error) ? (
        <CollectionSkeleton label="Loading items" view={view} />
      ) : (
        <CollectionItems
          columnSetId="space-overview"
          fields={["Type", "Favorite", "Created"]}
          sortResetKey={refinement.sortKey}
          view={view}
          creatorLabel={filter === "suggested" ? "Needs attention" : "Added by"}
          items={items.map((item) => {
            const Icon = icons[item.kind];
            return {
              ...item,
              ...itemActions.forItem(item),
              // Files take their type's glyph and tone, matching the explorer and Library.
              icon: item.libraryItem?.file ? (
                <FileNameIcon name={item.libraryItem.file.original_filename} size={18} />
              ) : (
                <Icon size={18} />
              ),
              tone: tones[item.kind],
              preview:
                view === "grid" && item.libraryItem?.file ? (
                  <LibraryItemThumbnail
                    api={spacesApi}
                    spaceId={space.id}
                    item={item.libraryItem}
                  />
                ) : undefined,
              category: item.area,
              metadata: {
                Type: {
                  note: "Note",
                  drawing: "Drawing",
                  file: "File",
                  chat: "Chat",
                  task: "Task",
                }[item.kind],
                Favorite: item.favorite ? "Yes" : "No",
                Created: item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "—",
              },
              sortValues: { Created: item.createdAt ? Date.parse(item.createdAt) : undefined },
              creator:
                filter === "suggested"
                  ? suggestions.find((s) => s.item.id === item.id)?.reason
                  : creatorName(item.creatorUserId, item.creatorAgentId),
              creatorDescription:
                filter === "suggested"
                  ? suggestions.find((s) => s.item.id === item.id)?.reason
                  : `${item.kind === "file" ? "Added" : "Created"} by ${creatorName(item.creatorUserId, item.creatorAgentId)}`,
              updated: item.updatedAt
                ? new Date(item.updatedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })
                : "—",
              onOpen: () => navigate(item.route),
            };
          })}
        />
      )}
    </CollectionPage>
  );
}
