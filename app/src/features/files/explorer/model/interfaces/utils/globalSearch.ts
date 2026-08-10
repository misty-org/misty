import type { SavedSearchRule } from "@/native/contracts";
import type { SearchQueryScope } from "@/native/contracts/primitives";

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
