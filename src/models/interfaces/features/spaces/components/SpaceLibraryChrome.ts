import { Grid2X2, Image as ImageIcon, List, Search, Upload, X } from "lucide-react";
import { EmptyState } from "@/ui";
import { Toolbar, ToolbarGroup } from "@/ui";
import { Button } from "@/ui";
import { Input } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { ToggleGroup, ToggleGroupItem } from "@/ui";
import type { LibraryItemQuery } from "@/models/interfaces/features/spaces/types";

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
