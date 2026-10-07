import { LayoutGrid, List, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Space } from "@/api/spaces/dto/entities";
import { useAuth } from "@/features/auth";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { usePersonalAgentsStore } from "@/features/agents";
import {
  Button,
  CollectionSkeleton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Input,
  SegmentedControl,
} from "@/shared/ui";
import { preloadSpaceSection } from "../SpaceSectionView";
import { useSpaceItemCreator } from "../useSpaceItemCreator";
import { GalleryCard } from "./GalleryCard";
import {
  agentChatItem,
  galleryFilters,
  isGalleryFilter,
  visibleGallery,
  type GalleryFilter,
  type GalleryItem,
  type GalleryMadeBy,
  type GallerySort,
} from "./galleryItems";
import { MakeSomethingNew } from "./MakeSomethingNew";
import { SpaceHomeMembers } from "./SpaceHomeMembers";
import { useSpaceGallery } from "./useSpaceGallery";
import { readHomePreference, writeHomePreference } from "./homePreferences";

/**
 * A Space's home: everything people and agents made in it, as one gallery. The tabs
 * filter by kind (the old sections), the toolbar searches, switches grid and list,
 * and filters by maker and order. Items open in their own editors.
 */
export function SpaceHome({ space }: { space: Space }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const requested = params.get("filter");
  const filter: GalleryFilter = isGalleryFilter(requested) ? requested : "all";
  const me = user?.id ?? "";
  const gallery = useSpaceGallery(space.id, me);
  // Your agent chats are yours, so they show in your own Space.
  const own = space.is_default && space.role === "owner";
  const agentConversations = useMistyStore((state) => state.conversations);
  const agents = usePersonalAgentsStore((state) => state.agents);
  useEffect(() => {
    if (!own || !me) return;
    const store = useMistyStore.getState();
    if (store.accountId !== me) store.setAccount(me);
    void store.loadConversations();
    void usePersonalAgentsStore.getState().load(me);
  }, [own, me]);
  const maker = useSpaceItemCreator(space.id);
  const [view, setView] = useState<"grid" | "list">(() => readHomePreference("view", "grid"));
  const [madeBy, setMadeBy] = useState<GalleryMadeBy>(() => readHomePreference("madeBy", "anyone"));
  const [sort, setSort] = useState<GallerySort>(() => readHomePreference("sort", "edited"));
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [openError, setOpenError] = useState("");

  const items = useMemo(() => {
    const agentChats = own
      ? agentConversations
          .filter((conversation) => conversation.messages.length)
          .map((conversation) =>
            agentChatItem(
              conversation,
              agents.find((agent) => agent.id === conversation.agentId) ??
                agents.find((agent) => agent.system_managed),
              me,
            ),
          )
      : [];
    return visibleGallery([...gallery.items, ...agentChats], { filter, madeBy, sort, me, query });
  }, [gallery.items, own, agentConversations, agents, filter, madeBy, sort, me, query]);

  const chooseFilter = (next: GalleryFilter) => {
    const search = new URLSearchParams(location.search);
    if (next === "all") search.delete("filter");
    else search.set("filter", next);
    navigate({ pathname: location.pathname, search: search.toString() ? `?${search}` : "" });
  };
  const open = async (item: GalleryItem) => {
    setOpenError("");
    try {
      if (item.href.startsWith("/spaces/"))
        await preloadSpaceSection(item.href.split("?")[0].split("/")[3]);
      navigate(item.href);
    } catch {
      setOpenError(`Couldn't open ${item.title}. Try again.`);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col px-8 pb-10 pt-7">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="m-0 min-w-0 truncate font-serif text-[32px] font-medium leading-tight text-cream-bright">
            {space.name || "Space"}
          </h1>
          <SpaceHomeMembers space={space} />
        </header>

        <div
          className="mb-6 mt-5 flex flex-wrap items-center gap-1"
          role="toolbar"
          aria-label="Space contents"
        >
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Kinds">
            {galleryFilters.map((option) => (
              <Button
                key={option.id}
                variant="chip"
                size="sm"
                aria-pressed={filter === option.id}
                onClick={() => chooseFilter(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1">
            {searching ? (
              <div className="flex items-center gap-1">
                <Input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Search ${space.name || "this Space"}`}
                  aria-label="Search this Space"
                  className="h-8 w-56"
                />
                <IconButton
                  label="Close search"
                  onClick={() => (setQuery(""), setSearching(false))}
                >
                  <X aria-hidden />
                </IconButton>
              </div>
            ) : (
              <IconButton label="Search" onClick={() => setSearching(true)}>
                <Search aria-hidden />
              </IconButton>
            )}
            <SegmentedControl
              label="View"
              size="sm"
              value={view}
              onChange={(next) => (setView(next), writeHomePreference("view", next))}
              options={[
                {
                  value: "grid",
                  label: <LayoutGrid aria-hidden className="size-4" />,
                  ariaLabel: "Grid",
                },
                {
                  value: "list",
                  label: <List aria-hidden className="size-4" />,
                  ariaLabel: "List",
                },
              ]}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Filters">
                  <SlidersHorizontal aria-hidden />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52" data-misty-layer-portal>
                <DropdownMenuLabel>Made by</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={madeBy}
                  onValueChange={(next) => (
                    setMadeBy(next as GalleryMadeBy),
                    writeHomePreference("madeBy", next)
                  )}
                >
                  <DropdownMenuRadioItem value="anyone">Anyone</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="me">Me</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="others">Others</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={sort}
                  onValueChange={(next) => (
                    setSort(next as GallerySort),
                    writeHomePreference("sort", next)
                  )}
                >
                  <DropdownMenuRadioItem value="edited">Last edited</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {filter === "all" && !query && (
          <MakeSomethingNew spaceId={space.id} onCreated={gallery.reload} />
        )}

        <p className="m-0 mb-3 text-xs text-cream-muted">
          {filter === "all"
            ? "Recent"
            : galleryFilters.find((option) => option.id === filter)?.label}
        </p>
        {openError && (
          <p role="alert" className="m-0 mb-3 text-sm text-cream">
            {openError}
          </p>
        )}
        {gallery.failed.length > 0 && (
          <p role="status" className="m-0 mb-3 text-sm text-cream-muted">
            Couldn't load {gallery.failed.join(" and ")}. The rest is shown.{" "}
            <Button type="button" size="sm" variant="outline" onClick={gallery.reload}>
              Retry
            </Button>
          </p>
        )}
        {gallery.loading ? (
          <CollectionSkeleton label="Space contents" view={view} />
        ) : items.length === 0 ? (
          <EmptyState
            title={query ? "Nothing matches" : "Nothing here yet"}
            description={
              query
                ? "Try another word, or clear the search."
                : "Make something above, or ask an agent in the Space's chat."
            }
          />
        ) : (
          <div
            className={
              view === "grid"
                ? "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4"
                : "flex flex-col"
            }
          >
            {items.map((item) => (
              <GalleryCard
                key={item.key}
                item={item}
                spaceId={space.id}
                view={view}
                maker={maker(item.creatorId || undefined)}
                onOpen={(next) => void open(next)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
