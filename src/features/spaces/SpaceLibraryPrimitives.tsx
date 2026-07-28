/**
 * Shared Library building blocks.
 *
 * The implementations live in `libraryPrimitives/`; this file stays as the
 * single import path the Library surfaces already use.
 */
export type { LibraryAssetStackInput } from "@/models/types/features/spaces/SpaceLibraryPrimitives";

export { LibraryCanEditContext } from "./libraryPrimitives/LibraryCanEditContext";
export { AlbumCover } from "./libraryPrimitives/AlbumCover";
export { LibraryCollectionCard } from "./libraryPrimitives/LibraryCollectionCard";
export { LibraryDiscoveryCard } from "./libraryPrimitives/LibraryDiscoveryCard";
export { LibraryFacetGroup } from "./libraryPrimitives/LibraryFacetGroup";
export { LibraryItemThumbnail } from "./libraryPrimitives/LibraryItemThumbnail";
export { LibrarySelect } from "./libraryPrimitives/LibrarySelect";
export { libraryUtilityIcon } from "./libraryPrimitives/libraryUtilityIcon";
export {
  buildLibraryAssetStack,
  detectUploadedAssetStacks,
} from "./libraryPrimitives/libraryAssetStackInput";
export {
  activeSensitiveGrant,
  libraryFileTypeLabel,
  libraryItemMIME,
} from "./libraryPrimitives/libraryMediaTypes";
