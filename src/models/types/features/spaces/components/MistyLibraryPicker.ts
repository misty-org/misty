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

import type { MistyLibraryPickerProps } from "@/models/interfaces/features/spaces/components/MistyLibraryPicker";

export type LibraryMediaFilter = "all" | "image" | "video" | "audio" | "document";
