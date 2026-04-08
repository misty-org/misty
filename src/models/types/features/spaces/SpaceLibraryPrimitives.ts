import { createContext, useContext, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  File,
  History,
  Image as ImageIcon,
  BookOpenText as LibraryIcon,
  MessagesSquare,
  Pencil,
  Pin,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type {
  LibraryAssetStack,
  LibraryDiscoveryGroup,
  LibraryMapPoint,
  LibrarySearchFacets,
  SpaceLibraryItem,
} from "@/models/interfaces/features/spaces/types";
import { libraryItemThumbnailEligible } from "@/features/spaces/libraryThumbnail";

export type LibraryAssetStackInput = Pick<
  LibraryAssetStack,
  "kind" | "title" | "cover_item_id" | "motion_item_id" | "members"
>;
