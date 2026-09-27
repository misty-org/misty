import type { SavedSearchRule } from "@/native/ipc";
import type { SearchQueryScope } from "@/native/ipc/primitives";

export interface ExplorerSearchOptions {
  currentPath?: string | null;
  scope?: SearchQueryScope;
  includeFiles?: boolean;
  includeDirectories?: boolean;
  includeHidden?: boolean;
  limit?: number | null;
  rules?: SavedSearchRule[];
  matchMode?: "all" | "any";
}
