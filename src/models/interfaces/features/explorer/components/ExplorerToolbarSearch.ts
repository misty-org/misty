import type { SearchResult } from "@/models/interfaces/services/misty-api";
import { Button } from "@/ui";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/ui";
import { Command as CommandIcon, Folder, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useExplorerStore, type ExplorerCommandQueryMode } from "@/stores/explorer";
import { useSearchStore } from "@/stores/explorer";
import {
  mergeHybridSearchResults,
  queryIndexedExplorerSearch,
  querySemanticExplorerSearch,
  semanticQueryMinimumCharacters,
  semanticSearchDebounceMs,
} from "@/features/explorer/utils/globalSearch";
import { searchResultNavigationTarget } from "@/features/explorer/utils/searchNavigation";
import type { ExplorerSearchNavigationTarget } from "@/models/interfaces/features/explorer/utils/searchNavigation";
import { SearchResultThumbnail } from "@/features/explorer/components/SearchResultThumbnail";
import { explorerCommandPaletteEntries } from "@/features/explorer/components/ExplorerToolbarModel";
import type { ExplorerLocationResult } from "@/models/interfaces/features/explorer/components/ExplorerToolbarModel";
import {
  fuzzyIncludes,
  searchResultContext,
  searchResultSummary,
  toolbarStyles,
} from "@/features/explorer/components/ExplorerToolbarSupport";
import type { PluginCommandEntry } from "@/models/interfaces/services/misty-api";

export interface ExplorerToolbarSearchProps {
  paneId: string;
  path: string;
  commandQuery: string;
  commandQueryMode: ExplorerCommandQueryMode;
  locationResults: ExplorerLocationResult[];
  pluginCommands: PluginCommandEntry[];
  onCommandQuery: (value: string) => void;
  onNavigateLocation: (path: string) => void;
  onNavigateSearchResult: (target: ExplorerSearchNavigationTarget) => void;
  onRunCommand: (commandId: string) => void;
}
