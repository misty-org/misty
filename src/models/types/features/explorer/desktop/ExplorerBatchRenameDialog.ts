import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui";
import { Button } from "@/ui";
import { Checkbox } from "@/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui";
import { Input } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { validateBatchRenameItems, useExplorerStore } from "@/stores/explorer";
import type { ExplorerBatchRenameItem, ExplorerDialogState } from "@/stores/explorer";

import type { BatchRenameOptions } from "@/models/interfaces/features/explorer/desktop/ExplorerBatchRenameDialog";

export type BatchRenameCaseMode = "none" | "lower" | "upper" | "title";
