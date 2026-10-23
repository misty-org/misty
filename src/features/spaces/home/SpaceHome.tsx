import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Space } from "@/api/spaces/dto/entities";
import { setItemVisibility, type ItemVisibility } from "@/api/spaces/visibility";
import { useAuth } from "@/features/auth";
import { OrderedCollectionFilters } from "@/features/settings/OrderedCollectionFilters";
import {
  Button,
  CollectionHeading,
  CollectionItems,
  CollectionPage,
  CollectionSearch,
  CollectionSkeleton,
  CollectionViewToggle,
  CollectionSelectionBar,
  useCollectionRefinement,
} from "@/shared/ui";
import { useRangeSelection } from "@/shared/hooks/useRangeSelection";
import { confirmAction } from "@/shared/lib/confirmAction";
import { useSpacesStore } from "@/features/spaces/core";
import { closeDrawingCollaborationSession, notifyDrawingListChanged } from "@/features/journal";
import { preloadSpaceSection } from "../SpaceSectionView";
import { useSpaceItemCreator } from "../useSpaceItemCreator";
import { editedLabel, galleryFilters, type GalleryItem, isGalleryFilter } from "./galleryItems";
import { GalleryPreview, kindIcon } from "./GalleryPreview";
import { readHomePreference, writeHomePreference } from "./homePreferences";
import { MakeSomethingNew } from "./MakeSomethingNew";
import { SpaceItemCard } from "./SpaceItemCard";
import { useSpaceGallery } from "./useSpaceGallery";

const scopes = [
  { value: "all", label: "All" },
  { value: "yours", label: "Yours" },
];

/**
 * A Space's home: everything people and agents made in it, chats included, in Misty's
 * collection layout. All or Yours picks whose things show; the filter menu narrows by
 * type and sets the order. Cards preview the item itself, and items open in their own pages.
 */
export function SpaceHome({ space }: { space: Space }) {
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

  const searched = useMemo(() => {
    const words = query.trim().toLocaleLowerCase();
    return gallery.items.filter(
      (item) =>
        (scope !== "yours" || item.creatorId === me) &&
        (!words ||
          item.title.toLocaleLowerCase().includes(words) ||
          item.excerpt?.toLocaleLowerCase().includes(words)),
    );
  }, [gallery.items, scope, me, query]);
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
  const deleteSelected = async () => {
    if (deleting || !selection.selectedIds.length) return;
    const selected = selection.selectedIds
      .map((key) => refinement.items.find((item) => item.key === key))
      .filter((item) => item?.remove);
    if (!selected.length) return;
    const removalLabels = [...new Set(selected.map((item) => item!.removeLabel ?? "Remove"))];
    const confirmation =
      removalLabels.length === 1 && removalLabels[0] === "Delete"
        ? `Permanently delete ${selected.length} selected ${selected.length === 1 ? "item" : "items"}?`
        : removalLabels.length === 1 && removalLabels[0] === "Move to Trash"
          ? `Move ${selected.length} selected ${selected.length === 1 ? "file" : "files"} to Trash?`
          : removalLabels.length === 1 && removalLabels[0] === "Unlink"
            ? `Unlink ${selected.length} selected ${selected.length === 1 ? "project" : "projects"} ` +
              "from this Space? Their files stay on their owners' computers."
            : `Remove ${selected.length} selected items? Files will move to Trash, projects will be unlinked, and other items will be deleted.`;
    if (!(await confirmAction(confirmation))) return;
    setDeleting(true);
    setDeleteError("");
    try {
      for (const item of selected) {
        await item!.remove!();
        if (item!.kind === "drawing") {
          closeDrawingCollaborationSession(space.id, item!.key.slice("drawing:".length));
          notifyDrawingListChanged(space.id);
        }
        const eventKind =
          item!.kind === "chat" ? "conversation" : item!.kind === "file" ? "library" : item!.kind;
        window.dispatchEvent(
          new CustomEvent(`misty:space-${eventKind}-event`, { detail: { space_id: space.id } }),
        );
      }
      selection.clear();
      gallery.reload();
    } catch {
      setDeleteError("Some selected items couldn't be removed. Refresh and try again.");
      gallery.reload();
    } finally {
      setDeleting(false);
    }
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

  return (
    <CollectionPage className="bg-charcoal-bg">
      <CollectionHeading
        title={space.name || "Space"}
        actions={
          <>
            <CollectionSearch
              aria-label="Search this Space"
              placeholder={`Search ${space.name || "this Space"}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </>
        }
      />
      {!query && <MakeSomethingNew spaceId={space.id} onCreated={gallery.reload} />}
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
      <CollectionSelectionBar
        count={selection.selectedIds.length}
        busy={deleting}
        label="Remove"
        onClear={selection.clear}
        onDelete={() => void deleteSelected()}
      />
      {deleteError && (
        <p role="alert" className="text-sm text-cream-muted">
          {deleteError}
        </p>
      )}
      {openError && (
        <p role="alert" className="text-sm text-cream">
          {openError}
        </p>
      )}
      {gallery.failed.length > 0 && (
        <div role="status" className="flex items-center gap-3 text-sm text-cream-muted">
          Couldn't load {gallery.failed.join(" and ")}. The rest is shown.
          <Button variant="ghost" size="sm" onClick={gallery.reload}>
            Retry
          </Button>
        </div>
      )}
      {gallery.loading ? (
        <CollectionSkeleton label="Space contents" view={view} />
      ) : view === "grid" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
          {refinement.items.map((item) => (
            <SpaceItemCard
              key={item.key}
              item={item}
              spaceId={space.id}
              solo={space.member_count <= 1}
              onOpen={() => void open(item)}
              selected={selection.selectedIds.includes(item.key)}
              onSelect={selection.select}
              onVisibilityChange={
                item.toggle && item.creatorId === me
                  ? (visibility) => void changeVisibility(item, visibility)
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        <CollectionItems
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
    </CollectionPage>
  );
}
