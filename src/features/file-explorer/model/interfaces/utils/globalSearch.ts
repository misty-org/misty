import type { SavedSearchRule } from "@/services/misty/model/misty-api";
import type { SearchQueryScope } from "@/services/misty/model/types/misty-api";

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
