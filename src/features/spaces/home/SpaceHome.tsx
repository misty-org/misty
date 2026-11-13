import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Space } from "../api/dto/entities";
import { setItemVisibility, type ItemVisibility } from "../api/visibility";
import { useAuth } from "@/features/account";
import { OrderedCollectionFilters } from "@/features/settings/OrderedCollectionFilters";
import {
  CollectionHeading,
  CollectionItems,
  CollectionPage,
  CollectionSearch,
  CollectionSkeleton,
  CollectionViewToggle,
  MenuItem,
  useCollectionRefinement,
  useNotice,
} from "@/shared/ui";
import { useRangeSelection } from "@/shared/hooks/useRangeSelection";
import { confirmAction } from "@/shared/lib/confirmAction";
import { useSpacesStore } from "@/features/spaces/core";
import { closeDrawingCollaborationSession, notifyDrawingListChanged } from "../journal";
import { preloadSpaceSection } from "../overview/SpaceSectionView";
import { useSpaceItemCreator } from "../overview/useSpaceItemCreator";
import { SpaceOptionsMenu } from "../components/space-row/SpaceOptionsMenu";
import { SpaceSwitcher } from "../components/space-row/SpaceSwitcher";
import { editedLabel, galleryFilters, type GalleryItem, isGalleryFilter } from "./galleryItems";
import { GalleryPreview, kindIcon } from "./GalleryPreview";
import { GetStartedCard } from "./GetStartedCard";
import { readHomePreference, writeHomePreference } from "./homePreferences";
import { HomeSectionHead } from "./HomeSection";
import { MakeSomethingNew } from "./MakeSomethingNew";
import { SpaceItemCard } from "./SpaceItemCard";
import { SpaceOverview } from "./SpaceOverview";
import { SpacePlaces } from "./SpacePlaces";
import { SpaceTeamwork } from "./SpaceTeamwork";
import { useSpaceGallery } from "./useSpaceGallery";

const journalKinds = ["note", "drawing"] as const;

const removalVerb = (items: GalleryItem[]) => {
  const labels = new Set(items.map((item) => item.removeLabel ?? "Remove"));
  return labels.size === 1 ? [...labels][0] : "Remove";
};

/** The menu's label: "Delete", or with a count when it acts on several ("Delete 3 items"). */
function removalLabel(items: GalleryItem[]): string {
  const verb = removalVerb(items);
  if (items.length < 2) return verb;
  const count = `${items.length} items`;
  return verb === "Move to Trash" ? `Move ${count} to Trash` : `${verb} ${count}`;
}

/** What the person is asked before anything is removed. */
function removalQuestion(items: GalleryItem[]): string {
  const what = items.length === 1 ? `“${items[0].title}”` : `${items.length} items`;
  switch (removalVerb(items)) {
    case "Delete":
      return `Permanently delete ${what}?`;
    case "Move to Trash":
      return `Move ${what} to Trash?`;
    case "Unlink":
      return `Unlink ${what} from this Space? Their files stay on their owners' computers.`;
    default:
      return `Remove ${what}? Files will move to Trash, projects will be unlinked, and other items will be deleted.`;
  }
}
const scopes = [
  { value: "all", label: "All" },
  { value: "yours", label: "Yours" },
];

/**
 * A Space's page: its pages, what waits for the person, their agents, chats and folders. Its title
 * switches the window to another Space. Its
 * items live on their own pages and show here only as search results, in Misty's collection
 * layout. All or Yours picks whose things show; the filter menu narrows by type and sets the
 * order. New in the head makes a note or drawing, or adds files. As the Journal it holds the
 * Space's docs and drawings, without the home's overview.
 */
export function SpaceHome({ space, journal = false }: { space: Space; journal?: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Links such as the Space bar's Notes and Drawings open the home on that type.
  const asked = new URLSearchParams(location.search).get("filter");
  const requestedFacet = isGalleryFilter(asked)
    ? (galleryFilters.find((option) => option.id === asked)?.kind ?? "all")
    : "all";
  const me = user?.id ?? "";
  const referenceOnly = useSpacesStore((state) => state.referenceOnly);
  const gallery = useSpaceGallery(space.id, me, !referenceOnly, space.role === "owner");
  const maker = useSpaceItemCreator(space.id);
  const [view, setView] = useState<"grid" | "list">(() => readHomePreference("view", "grid"));
  const [scope, setScope] = useState(() => readHomePreference<string>("scope", "all"));
  const [query, setQuery] = useState("");
  const [openError, setOpenError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  // On the home, items show only as search results.
  const showItems = journal || Boolean(query.trim());

  const searched = useMemo(() => {
    const words = query.trim().toLocaleLowerCase();
    return gallery.items.filter(
      (item) =>
        (!journal || item.kind === "note" || item.kind === "drawing") &&
        (scope !== "yours" || item.creatorId === me) &&
        (!words ||
          item.title.toLocaleLowerCase().includes(words) ||
          item.excerpt?.toLocaleLowerCase().includes(words)),
    );
  }, [gallery.items, journal, scope, me, query]);
  const refinement = useCollectionRefinement(searched, {
    label: "Filter this Space",
    requestedFacet,
    title: (item) => item.title,
    date: (item) => item.updatedAt,
    facet: {
      label: "Type",
      value: (item) => item.kind,
      options: galleryFilters.map((option) => ({
        value: option.kind ?? "all",
        label: option.kind ? option.label : "Everything",
      })),
    },
  });
  const selection = useRangeSelection(
    refinement.items.filter((item) => item.remove).map((item) => item.key),
  );
  const removeItems = async (items: GalleryItem[]) => {
    if (deleting || !items.length) return;
    if (!(await confirmAction(removalQuestion(items)))) return;
    setDeleting(true);
    setDeleteError("");
    try {
      for (const item of items) {
        await item.remove!();
        if (item.kind === "drawing") {
          closeDrawingCollaborationSession(space.id, item.key.slice("drawing:".length));
          notifyDrawingListChanged(space.id);
        }
        const eventKind =
          item.kind === "chat" ? "conversation" : item.kind === "file" ? "library" : item.kind;
        window.dispatchEvent(
          new CustomEvent(`misty:space-${eventKind}-event`, { detail: { space_id: space.id } }),
        );
      }
      selection.clear();
      gallery.reload();
    } catch {
      setDeleteError(
        items.length === 1
          ? `Couldn't remove ${items[0].title}. Try again.`
          : "Some items couldn't be removed. Refresh and try again.",
      );
      gallery.reload();
    } finally {
      setDeleting(false);
    }
  };

  /** The right-click menu: it acts on the selection when the item is in it, else on the item. */
  const itemMenu = (item: GalleryItem) => {
    if (!item.remove) return undefined;
    const targets = selection
      .menuTargets(item.key)
      .map((key) => refinement.items.find((candidate) => candidate.key === key))
      .filter((candidate): candidate is GalleryItem => Boolean(candidate?.remove));
    return (
      <MenuItem
        icon={Trash2}
        label={removalLabel(targets)}
        danger
        disabled={deleting}
        onSelect={() => void removeItems(targets)}
      />
    );
  };

  // Only the owner flips an item; the gallery reloads in the background.
  const changeVisibility = async (item: GalleryItem, visibility: ItemVisibility) => {
    if (!item.toggle) return;
    setOpenError("");
    try {
      await setItemVisibility(space.id, item.toggle.kind, item.toggle.id, visibility);
      gallery.reload();
    } catch {
      setOpenError(`Couldn't make ${item.title} ${visibility}. Try again.`);
    }
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

  useNotice(Boolean(deleteError), {
    message: deleteError,
    tone: "error",
    onDismiss: () => setDeleteError(""),
  });
  useNotice(Boolean(openError), {
    message: openError,
    tone: "error",
    onDismiss: () => setOpenError(""),
  });
  useNotice(showItems && gallery.failed.length > 0, {
    message: `Couldn't load ${gallery.failed.join(" and ")}. The rest is shown.`,
    tone: "error",
    action: { label: "Retry", onSelect: gallery.reload },
  });

  return (
    <CollectionPage className="bg-charcoal-bg">
      <CollectionHeading
        title={
          journal ? (
            "Docs"
          ) : (
            <span data-tour="space-switcher" className="contents">
              <SpaceSwitcher space={space} />
            </span>
          )
        }
        end={
          <div className="flex min-w-0 items-center gap-2">
            <CollectionSearch
              aria-label={journal ? "Search the journal" : "Search this Space"}
              placeholder="Search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <span data-tour="space-make" className="contents">
              <MakeSomethingNew
                spaceId={space.id}
                onCreated={gallery.reload}
                only={journal ? journalKinds : undefined}
              />
            </span>
            {!journal && (
              <span data-tour="space-options" className="contents">
                <SpaceOptionsMenu space={space} />
              </span>
            )}
          </div>
        }
      />
      {!showItems && (
        <div className="space-home">
          <span data-tour="space-places" className="contents">
            <SpacePlaces spaceId={space.id} />
          </span>
          <GetStartedCard
            space={space}
            wroteDoc={gallery.items.some((item) => item.kind === "note" && item.creatorId === me)}
          />
          <SpaceOverview spaceId={space.id} />
          {space.is_shared && <SpaceTeamwork spaceId={space.id} />}
        </div>
      )}
      {/* Home shows only its overview; the items themselves live on their pages. */}
      {showItems && (
        <>
          {!journal && (
            <div className="home-items-head">
              <HomeSectionHead title="Results" />
            </div>
          )}
          <OrderedCollectionFilters
            collectionId="space"
            options={scopes}
            value={scope}
            onChange={(next) => (setScope(next), writeHomePreference("scope", next))}
            filterControl={refinement.control}
            actions={
              <CollectionViewToggle
                value={view}
                onChange={(next) => (setView(next), writeHomePreference("view", next))}
              />
            }
          />
          {gallery.loading ? (
            <CollectionSkeleton label="Space contents" view={view} />
          ) : view === "grid" ? (
            <div className="home-items-wrap">
              <div className="home-items">
                {refinement.items.map((item) => (
                  <SpaceItemCard
                    key={item.key}
                    item={item}
                    spaceId={space.id}
                    solo={space.member_count <= 1}
                    onOpen={() => void open(item)}
                    selected={selection.selectedIds.includes(item.key)}
                    onSelect={selection.select}
                    contextMenu={itemMenu(item)}
                    onContextMenuOpen={() => selection.pickForMenu(item.key)}
                    onVisibilityChange={
                      item.toggle && item.creatorId === me
                        ? (visibility) => void changeVisibility(item, visibility)
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          ) : (
            <CollectionItems
              listIcons
              columnSetId="space-home"
              view={view}
              sortResetKey={refinement.sortKey}
              categoryLabel="Type"
              items={refinement.items.map((item) => {
                const { Icon, tone, label } = kindIcon[item.kind];
                return {
                  id: item.key,
                  title: item.title,
                  icon: <Icon />,
                  tone,
                  preview: (
                    <span className="block size-full text-left">
                      <GalleryPreview item={item} spaceId={space.id} />
                    </span>
                  ),
                  category: label,
                  selectable: Boolean(item.remove),
                  menu: itemMenu(item),
                  onMenuOpen: () => selection.pickForMenu(item.key),
                  creator: maker(item.creatorId || undefined),
                  updatedAt: item.updatedAt,
                  updated: editedLabel(item.updatedAt),
                  onOpen: () => void open(item),
                };
              })}
              selectedIds={selection.selectedIds}
              onSelect={selection.select}
            />
          )}
        </>
      )}
    </CollectionPage>
  );
}
