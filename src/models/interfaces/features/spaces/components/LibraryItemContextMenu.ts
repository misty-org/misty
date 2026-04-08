import { useEffect, useRef, useState } from "react";
import {
  ArchiveRestore,
  ClipboardCopy,
  Copy,
  FolderPlus,
  Pencil,
  Star,
  Tags,
  Trash2,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/ui";
import type { LibraryAlbum, SpaceLibraryItem } from "@/models/interfaces/features/spaces/types";

export interface LibraryItemMenuState {
  itemId: string;
  left: number;
  top: number;
}
