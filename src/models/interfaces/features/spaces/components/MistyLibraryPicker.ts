import type { ReactNode } from "react";
import { BookOpenText, Check, File, Image, Music2, Search, Video } from "lucide-react";
import { Badge } from "@/ui";
import { Button } from "@/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui";
import { Input } from "@/ui";
import { ScrollArea } from "@/ui";
import { Skeleton } from "@/ui";
import { ToggleGroup, ToggleGroupItem } from "@/ui";
import { cn } from "@/ui";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { SpaceLibraryItem } from "@/models/interfaces/features/spaces/types";

import type { LibraryMediaFilter } from "@/models/types/features/spaces/components/MistyLibraryPicker";

export interface MistyLibraryPickerProps {
  spaceId: string;
  /** Render only the picker panel when a parent owns the shared dialog shell. */
  embedded?: boolean;
  /** Whether this embedded panel is currently visible. */
  active?: boolean;
  /** Source switcher rendered in the header when this picker is hosted by MistyPicker. */
  sourceToggle?: ReactNode;
  selectedIds: string[];
  maximumSelected?: number;
  onCancel: () => void;
  onChoose: (itemIds: string[]) => void;
}
