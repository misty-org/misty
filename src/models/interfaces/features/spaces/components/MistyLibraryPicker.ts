import { useEffect, useMemo, useRef, useState } from "react";
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
  selectedIds: string[];
  maximumSelected?: number;
  onCancel: () => void;
  onChoose: (itemIds: string[]) => void;
}
