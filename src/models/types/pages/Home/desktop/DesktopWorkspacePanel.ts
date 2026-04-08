import { useEffect, useState } from "react";
import { Briefcase, Pencil, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useExplorerStore, type ExplorerWorkspaceEntry } from "@/stores/explorer";
import { WorkspaceDialog } from "@/features/explorer/components/ExplorerSidebarSupport";
import type { WorkspaceDialogState } from "@/models/types/features/explorer/components/ExplorerSidebarSupport";
import { Button } from "@/ui";

export type DesktopWorkspacePanelProps = {
  homePath: string;
};
