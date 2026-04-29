import type { LibraryItemQuery } from "@/services/spaces/dto/interfaces/types";
import type { LibraryUploadJob } from "../useSpaceLibraryData";

export interface SpaceLibraryHeaderProps {
  uploadAvailable: boolean;
  uploading: boolean;
  uploadDisabled: boolean;
  onUpload: () => void;
  searchInput: string;
  onSearchInput: (value: string) => void;
  onSearchFocus: () => void;
  onSearchBlur: () => void;
  mediaType: string;
  onMediaType: (value: string) => void;
  sort: NonNullable<LibraryItemQuery["sort"]>;
  direction: NonNullable<LibraryItemQuery["direction"]>;
  onSort: (
    sort: NonNullable<LibraryItemQuery["sort"]>,
    direction: NonNullable<LibraryItemQuery["direction"]>,
  ) => void;
  albumOrderAvailable: boolean;
  viewMode: "grid" | "list";
  onViewMode: (mode: "grid" | "list") => void;
  itemScale: number;
  onItemScale: (scale: number) => void;
  visibleItemCount: number;
  // Upload progress lives in the toolbar so it never displaces Library content.
  uploadJobs: LibraryUploadJob[];
  onClearUploads: () => void;
}

export interface SpaceLibraryEmptyStateProps {
  collection: string;
  searching?: boolean;
  uploadAvailable: boolean;
  uploading: boolean;
  uploadDisabled: boolean;
  onUpload: () => void;
  onClearSearch?: () => void;
}
