/**
 * Shared Library building blocks.
 *
 * The implementations live in `libraryPrimitives/`; this file stays as the
 * single import path the Library surfaces already use.
 */
export type { LibraryAssetStackInput } from "@/api/spaces/dto/types/SpaceLibraryPrimitives";

export { AlbumCover } from "./libraryPrimitives/AlbumCover";
export {
  buildLibraryAssetStack,
  detectUploadedAssetStacks,
} from "./libraryPrimitives/libraryAssetStackInput";
export { LibraryCanEditContext } from "./libraryPrimitives/LibraryCanEditContext";
export { LibraryCollectionCard } from "./libraryPrimitives/LibraryCollectionCard";
export { LibraryDiscoveryCard } from "./libraryPrimitives/LibraryDiscoveryCard";
export { LibraryFacetGroup } from "./libraryPrimitives/LibraryFacetGroup";
export { LibraryItemThumbnail } from "./libraryPrimitives/LibraryItemThumbnail";
export {
  activeSensitiveGrant,
  libraryFileTypeLabel,
  libraryItemMIME,
} from "./libraryPrimitives/libraryMediaTypes";
export { LibrarySelect } from "./libraryPrimitives/LibrarySelect";
export { libraryUtilityIcon } from "./libraryPrimitives/libraryUtilityIcon";
