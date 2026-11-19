import { SpaceCrumb } from "../components/space-row/SpaceCrumb";
import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Space } from "../api/dto/entities";
import type { ItemVisibility } from "../api/visibility";
import { setHostVisibility } from "../embeds/hostVisibility";
import { useAuth } from "@/features/account";
import { OrderedCollectionFilters } from "@/features/settings/OrderedCollectionFilters";
import {
  CollectionHeading,
  CollectionItems,
  CollectionPage,
  CollectionSearch,
  CollectionSkeleton,
  CollectionViewToggle,
  EmptyState,
  ErrorState,
  MenuItem,
  spaceMadeKind,
  useCollectionRefinement,
  useNotice,
  type SpaceMadeKind,
} from "@/shared/ui";
import { useRangeSelection } from "@/shared/hooks/useRangeSelection";
import { confirmAction } from "@/shared/lib/confirmAction";
import { useSpacesStore } from "@/features/spaces/core";
import { closeDrawingCollaborationSession, notifyDrawingListChanged } from "../journal";
import { closeDeckCollaborationSession } from "../slides/session";
import { closeWorkbookCollaborationSession } from "../data/session";
import { preloadSpaceSection } from "../overview/SpaceSectionView";
import { useSpaceItemCreator } from "../overview/useSpaceItemCreator";
import { SpaceOptionsMenu } from "../components/space-row/SpaceOptionsMenu";
import { SpaceSwitcher } from "../components/space-row/SpaceSwitcher";
import { editedLabel, galleryFilters, type GalleryItem, isGalleryFilter } from "./galleryItems";
import { GalleryPreview, itemIcon } from "./GalleryPreview";
import { useHomePreferences } from "./homePreferences";
import { HomeSection } from "./HomeSection";
import { homeItemsClass, homeItemsWrapClass, spaceHomeClass } from "./homeLayout";
import { MakeSomethingNew } from "./MakeSomethingNew";
import { SpaceItemCard, SpaceItemCardsSkeleton } from "./SpaceItemCard";
import { SpaceOverview } from "./SpaceOverview";
import { SpacePlaces } from "./SpacePlaces";
import { SpaceChatButton } from "../chat/SpaceChatButton";
import { useSpaceGallery } from "./useSpaceGallery";
import { HereFaces, useHereNow } from "./HereNow";
import { useNow } from "@/shared/hooks/useNow";

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
 * A Space's page, laid out like the Lab's home: its pages, then what's going on in the Space
 * (see SpaceOverview), then its things as the page's one collection, in Misty's collection
 * layout. Its title switches the window to another Space. A search narrows the collection and
 * puts it at the top. All or Yours picks whose things show; the filter menu narrows by type and sets the
 * order. This device remembers the view, All or Yours, and the filter menu's picks. New in the
 * head makes a doc or whiteboard, or adds files. As a kind's page (Docs, Whiteboards) it holds
 * only that kind, without the home's overview.
 */
export function SpaceHome({ space, page }: { space: Space; page?: SpaceMadeKind }) {
  const now = useNow();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Links such as the Space bar's Notes and Drawings open the home on that type; without one,
  // the type last picked here shows.
  const asked = new URLSearchParams(location.search).get("filter");
  const requestedFacet = isGalleryFilter(asked)
    ? (galleryFilters.find((option) => option.id === asked)?.kind ?? "all")
    : undefined;
  const me = user?.id ?? "";
  const pageKind = page ? spaceMadeKind(page) : undefined;
  const remember = pageKind ? `space-${pageKind.section}` : "space-home";
  const referenceOnly = useSpacesStore((state) => state.referenceOnly);
  const gallery = useSpaceGallery(space.id, me, !referenceOnly, space.role === "owner");
  // Who is in the Space now and where, for the bar's faces and the Here now panel.
  const here = useHereNow(space.id, gallery.items);
  const maker = useSpaceItemCreator(space.id);
  const { view, scope } = useHomePreferences((state) => state.value);
  const setHomePreferences = useHomePreferences((state) => state.set);
  const [query, setQuery] = useState("");
  const [openError, setOpenError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const searching = Boolean(query.trim());

  const searched = useMemo(() => {
    const words = query.trim().toLocaleLowerCase();
    return gallery.items.filter(
      (item) =>
        (!page || item.kind === page) &&
        (scope !== "yours" || item.creatorId === me) &&
        (!words ||
          item.title.toLocaleLowerCase().includes(words) ||
          item.excerpt?.toLocaleLowerCase().includes(words)),
    );
  }, [gallery.items, page, scope, me, query]);
  const refinement = useCollectionRefinement(searched, {
    label: "Filter this Space",
    requestedFacet,
    remember,
    title: (item) => item.title,
    date: (item) => item.updatedAt,
    // A kind's page holds one type, so only the home filters by it.
    facet: page
      ? undefined
      : {
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
        const id = item.key.slice(item.key.indexOf(":") + 1);
        if (item.kind === "drawing") {
          closeDrawingCollaborationSession(space.id, id);
          notifyDrawingListChanged(space.id);
        } else if (item.kind === "deck") closeDeckCollaborationSession(space.id, id);
        else if (item.kind === "workbook") closeWorkbookCollaborationSession(space.id, id);
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

  // Only the owner flips an item; the gallery reloads in the background. A doc or deck turning
  // shared shares what it embeds first, or stays private when the person declines.
  const changeVisibility = async (item: GalleryItem, visibility: ItemVisibility) => {
    if (!item.toggle) return;
    setOpenError("");
    try {
      if (await setHostVisibility(space.id, item.toggle.kind, item.toggle.id, visibility))
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
  // With every read failed the section says so itself, so the notice is for a partial failure.
  useNotice(gallery.failed.length > 0 && !gallery.unavailable, {
    message: `Couldn't load ${gallery.failed.join(" and ")}. The rest is shown.`,
    tone: "error",
    action: { label: "Retry", onSelect: gallery.reload },
  });

  return (
    <CollectionPage>
      <CollectionHeading
        title={
          pageKind ? (
            <SpaceCrumb spaceId={space.id} here={pageKind.page} />
          ) : (
            <span data-tour="space-switcher" className="contents">
              <SpaceSwitcher space={space} />
            </span>
          )
        }
        end={
          <div className="flex min-w-0 items-center gap-2">
            {!page && <HereFaces spaceId={space.id} here={here} />}
            {!page && <SpaceChatButton spaceId={space.id} />}
            <CollectionSearch
              data-tour="space-search"
              aria-label={pageKind ? `Search ${pageKind.page}` : "Search this Space"}
              placeholder="Search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <span data-tour="space-make" className="contents">
              <MakeSomethingNew
                spaceId={space.id}
                onCreated={gallery.reload}
                only={page ? [page] : undefined}
              />
            </span>
            {!page && (
              <span data-tour="space-options" className="contents">
                <SpaceOptionsMenu space={space} />
              </span>
            )}
          </div>
        }
      />
      {/* After the Lab's home: the Space's pages to go to, what is going on in it, then its
          things as the page's one collection, with their count, whose, filters and view. */}
      <div className={spaceHomeClass}>
        {!page && !searching && (
          <>
            <span data-tour="space-places" className="contents">
              <SpacePlaces spaceId={space.id} />
            </span>
            <SpaceOverview spaceId={space.id} shared={space.is_shared} here={here} />
          </>
        )}
        <HomeSection
          title={searching ? "Results" : (pageKind?.page ?? "In this Space")}
          count={gallery.loading || gallery.unavailable ? undefined : refinement.items.length}
          // Under the overview's panels, a hairline starts the Space's own things.
          divided={!page && !searching}
          action={
            <span data-tour="space-filters" className="contents">
              <OrderedCollectionFilters
                collectionId="space"
                options={scopes}
                value={scope}
                onChange={(next) =>
                  setHomePreferences((current) => ({
                    ...current,
                    scope: next === "yours" ? "yours" : "all",
                  }))
                }
                filterControl={refinement.control}
                actions={
                  <CollectionViewToggle
                    value={view}
                    onChange={(next) =>
                      setHomePreferences((current) => ({ ...current, view: next }))
                    }
                  />
                }
              />
            </span>
          }
        >
          {gallery.loading ? (
            view === "grid" ? (
              <SpaceItemCardsSkeleton />
            ) : (
              <CollectionSkeleton label="Space contents" view="list" icons />
            )
          ) : gallery.unavailable ? (
            <ErrorState
              inline
              title="This Space’s things couldn’t load"
              action={{ label: "Try again", variant: "secondary", onClick: gallery.reload }}
            />
          ) : !refinement.items.length ? (
            <EmptyState
              inline
              title={searching ? "Nothing matches" : "Nothing here yet"}
              line={
                searching
                  ? "Try other words, or show everyone's things."
                  : pageKind
                    ? `${pageKind.page} made in this Space show up here.`
                    : "Docs, whiteboards, notebooks and files made in this Space show up here."
              }
            />
          ) : view === "grid" ? (
            <div className={homeItemsWrapClass}>
              <div className={homeItemsClass}>
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
              remember={remember}
              view={view}
              sortResetKey={refinement.sortKey}
              categoryLabel="Type"
              items={refinement.items.map((item) => {
                const { Icon, tone, label } = itemIcon(item);
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
                  updated: editedLabel(item.updatedAt, now),
                  onOpen: () => void open(item),
                };
              })}
              selectedIds={selection.selectedIds}
              onSelect={selection.select}
            />
          )}
        </HomeSection>
      </div>
    </CollectionPage>
  );
}
