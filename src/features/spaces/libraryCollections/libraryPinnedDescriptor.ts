import {
  EyeOff,
  File,
  History,
  Image as ImageIcon,
  BookOpenText as LibraryIcon,
  MapPin,
  MessagesSquare,
  Music2,
  Sparkles,
  Star,
  Trash2,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { LibraryPinnedCollection } from "@/models/interfaces/features/spaces/types";
import type {
  LibraryCollectionKind,
  SpaceLibraryData,
} from "@/models/types/features/spaces/useSpaceLibraryData";
import { libraryUtilityIcon } from "../SpaceLibraryPrimitives";
import type { SelectCollection } from "./useLibraryCollectionRoute";

export interface PinnedDescriptor {
  label: string;
  count: number;
  icon: LucideIcon;
  onClick: () => void;
}

const mediaIcons: Record<string, LucideIcon> = {
  image: ImageIcon,
  video: Video,
  audio: Music2,
};

/**
 * Resolves a pin into its sidebar row, or null when its target is gone.
 *
 * Pins store only a kind and an id, so albums, memories, trips, media-type
 * facets and built-in collections each need looking up in a different place.
 */
export function usePinnedDescriptor(data: SpaceLibraryData, selectCollection: SelectCollection) {
  const {
    albums,
    discovery,
    searchFacets,
    sharedReferences,
    outgoingReferences,
    importHistory,
    setMediaType,
  } = data;

  const systemCollections: Record<
    string,
    Omit<PinnedDescriptor, "onClick"> & {
      collection: LibraryCollectionKind;
    }
  > = {
    recent: {
      label: "Recently Added",
      count: searchFacets.total,
      icon: LibraryIcon,
      collection: "recent",
    },
    months: {
      label: "Months",
      count: discovery.months.length,
      icon: History,
      collection: "months",
    },
    years: { label: "Years", count: discovery.years.length, icon: History, collection: "years" },
    "recent-days": {
      label: "Recent Days",
      count: discovery.recent_days.length,
      icon: LibraryIcon,
      collection: "recent-days",
    },
    favorites: {
      label: "Favorites",
      count: searchFacets.favorites,
      icon: Star,
      collection: "favorites",
    },
    albums: { label: "Albums", count: albums.length, icon: LibraryIcon, collection: "albums" },
    shared: {
      label: "Shared",
      count: sharedReferences.length + outgoingReferences.length,
      icon: MessagesSquare,
      collection: "shared",
    },
    imports: {
      label: "Imports",
      count: importHistory.length,
      icon: History,
      collection: "imports",
    },
    hidden: { label: "Hidden", count: searchFacets.hidden, icon: EyeOff, collection: "hidden" },
    deleted: {
      label: "Recently Deleted",
      count: searchFacets.recently_deleted,
      icon: Trash2,
      collection: "deleted",
    },
  };

  return (pin: LibraryPinnedCollection): PinnedDescriptor | null => {
    if (pin.target_kind === "album") {
      const album = albums.find((candidate) => candidate.id === pin.target_id);
      return album
        ? {
            label: album.name,
            count: album.item_count,
            icon: LibraryIcon,
            onClick: () => selectCollection("albums", album.id),
          }
        : null;
    }
    if (pin.target_kind === "group" || pin.target_kind === "person") return null;

    if (pin.target_kind === "memory" || pin.target_kind === "trip") {
      const kind = pin.target_kind;
      const group = (kind === "memory" ? discovery.memories : discovery.trips).find(
        (candidate) => candidate.id === pin.target_id,
      );
      return group
        ? {
            label: group.title,
            count: group.item_count,
            icon: kind === "memory" ? Sparkles : MapPin,
            onClick: () => selectCollection(kind, group.id),
          }
        : null;
    }

    const utility = searchFacets.utilities.find((facet) => facet.value === pin.target_id);
    if (utility)
      return {
        label: utility.label,
        count: utility.count,
        icon: libraryUtilityIcon(utility.value),
        onClick: () => selectCollection("utility", utility.value),
      };

    const media = searchFacets.media_types.find((facet) => facet.value === pin.target_id);
    if (media)
      return {
        label: media.label,
        count: media.count,
        icon: mediaIcons[media.value] ?? File,
        onClick: () => {
          setMediaType(media.value as Parameters<typeof setMediaType>[0]);
          selectCollection("recent");
        },
      };

    const descriptor = systemCollections[pin.target_id];
    return descriptor
      ? {
          label: descriptor.label,
          count: descriptor.count,
          icon: descriptor.icon,
          onClick: () => selectCollection(descriptor.collection),
        }
      : null;
  };
}
