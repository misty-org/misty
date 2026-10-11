import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Space } from "@/api/spaces/dto/entities";
import { setItemVisibility, type ItemVisibility } from "@/api/spaces/visibility";
import { useAuth } from "@/features/auth";
import { AccountCollectionFilters } from "@/features/settings/AccountCollectionFilters";
import {
  Button,
  CollectionHeading,
  CollectionItems,
  CollectionPage,
  CollectionSearch,
  CollectionSkeleton,
  CollectionViewToggle,
  useCollectionRefinement,
} from "@/shared/ui";
import { preloadSpaceSection } from "../SpaceSectionView";
import { useSpaceItemCreator } from "../useSpaceItemCreator";
import { editedLabel, galleryFilters, type GalleryItem } from "./galleryItems";
import { GalleryPreview, kindIcon } from "./galleryPreview";
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
  const me = user?.id ?? "";
  const gallery = useSpaceGallery(space.id, me);
  const maker = useSpaceItemCreator(space.id);
  const [view, setView] = useState<"grid" | "list">(() => readHomePreference("view", "grid"));
  const [scope, setScope] = useState(() => readHomePreference<string>("scope", "all"));
  const [query, setQuery] = useState("");
  const [openError, setOpenError] = useState("");

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
      <AccountCollectionFilters
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
              creator: maker(item.creatorId || undefined),
              updatedAt: item.updatedAt,
              updated: editedLabel(item.updatedAt),
              onOpen: () => void open(item),
            };
          })}
        />
      )}
    </CollectionPage>
  );
}

