import type { SmartFolderDraft } from "../../interfaces/components/ExplorerSidebarSupport";

export type WorkspaceDialogState =
  | { kind: "create"; workspaceId: ""; title: string }
  | { kind: "rename"; workspaceId: string; title: string }
  | { kind: "delete"; workspaceId: string; title: string }
  | null;

export type SmartFolderMatchMode = "all" | "any";

export type SmartFolderDialogState = { draft: SmartFolderDraft } | null;

export type QuickAccessMenuItem = {
  kind: "builtIn" | "pinned";
  label: string;
  path: string;
};
