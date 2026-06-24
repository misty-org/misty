import type { SmartFolderDraft } from "../../interfaces/components/ExplorerSidebarSupport";

export type SmartFolderMatchMode = "all" | "any";

export type SmartFolderDialogState = { draft: SmartFolderDraft } | null;

export type QuickAccessMenuItem = {
  kind: "builtIn" | "pinned";
  label: string;
  path: string;
};
