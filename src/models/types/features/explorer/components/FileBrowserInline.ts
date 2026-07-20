import { Input } from "@/ui";
import { TableCell, TableRow } from "@/ui";
import { useLayoutEffect, useRef } from "react";
import type { FileEntry } from "@/models/interfaces/services/misty-api";
import type { ExplorerInlineEditState, ExplorerSortColumn } from "@/stores/explorer";
import { FileIcon } from "@/features/explorer/components/FileBrowserIcons";
import { fileBrowserStyles } from "@/features/explorer/components/FileBrowserStyles";

export type PassiveRenameDraft = {
  value: string;
  lockedExtension: string;
  error: string | null;
};
