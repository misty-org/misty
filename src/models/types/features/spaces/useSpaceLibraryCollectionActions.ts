import { useEffect, type FormEvent } from "react";
import {
  EyeOff,
  File,
  History,
  Image as ImageIcon,
  BookOpenText as LibraryIcon,
  Map as MapIcon,
  MapPin,
  MessagesSquare,
  Music2,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Users,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { confirmAction } from "@/lib/confirmAction";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type {
  LibraryPinnedCollection,
  LibrarySharedReference,
} from "@/models/interfaces/features/spaces/types";
import { libraryUtilityIcon } from "@/features/spaces/SpaceLibraryPrimitives";
import { libraryCollectionKinds } from "@/features/spaces/useSpaceLibraryData";
import type {
  LibraryCollectionKind,
  SpaceLibraryData,
} from "@/models/types/features/spaces/useSpaceLibraryData";
import type { SpaceLibraryItemActions } from "@/models/types/features/spaces/useSpaceLibraryItemActions";

export type SpaceLibraryCollectionActions = ReturnType<typeof useSpaceLibraryCollectionActions>;
import type { useSpaceLibraryCollectionActions } from "@/features/spaces/useSpaceLibraryCollectionActions";
