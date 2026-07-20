import type { SearchResult } from "@/services/misty-api/types";
import { Button } from "../../../components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../../../components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import { Command as CommandIcon, Folder, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useExplorerStore, type ExplorerCommandQueryMode } from "../../../stores/useExplorerStore";
import { useSearchStore } from "../../../stores/useSearchStore";
import {
  mergeHybridSearchResults,
  queryIndexedExplorerSearch,
  querySemanticExplorerSearch,
  semanticQueryMinimumCharacters,
  semanticSearchDebounceMs,
} from "../utils/globalSearch";
import { searchResultNavigationTarget } from "../utils/searchNavigation";
import type { ExplorerSearchNavigationTarget } from "../utils/searchNavigation";
import { SearchResultThumbnail } from "./SearchResultThumbnail";
import { explorerCommandPaletteEntries, type ExplorerLocationResult } from "./ExplorerToolbarModel";
import {
  fuzzyIncludes,
  searchResultContext,
  searchResultSummary,
  toolbarStyles,
} from "./ExplorerToolbarSupport";
import type { PluginCommandEntry } from "@/services/misty-api/types";

interface ExplorerToolbarSearchProps {
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

export function ExplorerToolbarSearch(props: ExplorerToolbarSearchProps) {
  const [searchFocused, setSearchFocused] = useState(false);
  const [indexedResults, setIndexedResults] = useState<SearchResult[]>([]);
  const [indexedSearching, setIndexedSearching] = useState(false);
  const [indexedError, setIndexedError] = useState<string | null>(null);
  const indexedNativeResultsRef = useRef<SearchResult[]>([]);
  const indexedSemanticResultsRef = useRef<SearchResult[]>([]);
  const commandMode = props.commandQuery.trimStart().startsWith(">");
  const commandFilter = commandMode
    ? props.commandQuery.trimStart().slice(1).trim().toLowerCase()
    : "";
  const searchMode = props.commandQueryMode === "search";
  const locationFilter = commandMode || !searchMode ? "" : props.commandQuery.trim().toLowerCase();
  const paletteCommands = useMemo(
    () => explorerCommandPaletteEntries(props.pluginCommands),
    [props.pluginCommands],
  );
  const filteredCommands = useMemo(
    () =>
      paletteCommands.filter((command) => {
        if (!commandFilter) return true;
        const haystack = [
          command.id,
          command.label,
          command.hint,
          command.pluginName,
          command.group ?? "Explorer",
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(commandFilter);
      }),
    [commandFilter, paletteCommands],
  );
  const filteredLocations = useMemo(() => {
    if (!locationFilter) return [];
    return props.locationResults
      .filter((location) =>
        fuzzyIncludes(
          `${location.label} ${location.path} ${location.subtitle} ${location.badge}`.toLowerCase(),
          locationFilter,
        ),
      )
      .slice(0, 8);
  }, [locationFilter, props.locationResults]);
  const locationMode =
    searchFocused &&
    !commandMode &&
    Boolean(locationFilter) &&
    (filteredLocations.length > 0 ||
      indexedResults.length > 0 ||
      indexedSearching ||
      Boolean(indexedError));
  const paletteOpen = commandMode || locationMode;

  useEffect(() => {
    let canceled = false;
    const query = locationFilter.trim();
    indexedNativeResultsRef.current = [];
    indexedSemanticResultsRef.current = [];
    if (!query) {
      setIndexedResults([]);
      setIndexedSearching(false);
      setIndexedError(null);
      return;
    }

    setIndexedSearching(true);
    setIndexedError(null);
    let nativeError: string | null = null;
    let nativeFinished = false;
    let semanticFinished = query.replace(/\s/g, "").length < semanticQueryMinimumCharacters;
    const publish = () => {
      if (canceled) return;
      const results = mergeHybridSearchResults(
        indexedNativeResultsRef.current,
        indexedSemanticResultsRef.current,
        8,
      );
      setIndexedResults(results);
      setIndexedSearching(!nativeFinished || !semanticFinished);
      setIndexedError(results.length > 0 || !semanticFinished ? null : nativeError);
    };
    const nativeTimer = window.setTimeout(() => {
      void queryIndexedExplorerSearch(
        query,
        { scope: "everything", currentPath: props.path, limit: 8 },
        useExplorerStore.getState().library,
      )
        .then((results) => {
          if (canceled) return;
          indexedNativeResultsRef.current = results;
          nativeFinished = true;
          publish();
        })
        .catch((error: unknown) => {
          if (canceled) return;
          nativeError = error instanceof Error ? error.message : String(error);
          nativeFinished = true;
          publish();
        });
    }, 160);
    const semanticTimer = semanticFinished
      ? null
      : window.setTimeout(() => {
          void querySemanticExplorerSearch(query, {
            scope: "everything",
            currentPath: props.path,
            limit: 8,
          })
            .then((results) => {
              if (canceled) return;
              indexedSemanticResultsRef.current = results;
              semanticFinished = true;
              publish();
            })
            .catch(() => {
              if (canceled) return;
              semanticFinished = true;
              publish();
            });
        }, semanticSearchDebounceMs);

    return () => {
      canceled = true;
      window.clearTimeout(nativeTimer);
      if (semanticTimer !== null) window.clearTimeout(semanticTimer);
    };
  }, [locationFilter, props.path]);

  useEffect(() => {
    const onSearchFocus = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          paneId?: string;
          mode?: "search" | "command";
        }>
      ).detail;
      if (detail?.paneId !== props.paneId) return;
      if (detail.mode === "command") {
        setSearchFocused(true);
        return;
      }
      setSearchFocused(false);
      void useSearchStore.getState().openSearch(props.path);
    };
    window.addEventListener("misty:explorer-search-focus", onSearchFocus);
    return () => window.removeEventListener("misty:explorer-search-focus", onSearchFocus);
  }, [props.paneId, props.path]);

  const closePalette = () => {
    setSearchFocused(false);
    if (commandMode) props.onCommandQuery("");
  };
  const runCommand = (commandId: string) => {
    props.onRunCommand(commandId);
    props.onCommandQuery("");
    setSearchFocused(false);
  };
  const runLocation = (path: string) => {
    props.onNavigateLocation(path);
    props.onCommandQuery("");
    setSearchFocused(false);
  };
  const runIndexedResult = (result: SearchResult) => {
    props.onNavigateSearchResult(searchResultNavigationTarget(result));
    props.onCommandQuery("");
    setSearchFocused(false);
  };

  return (
    <Popover
      open={paletteOpen}
      onOpenChange={(open) => {
        if (!open) closePalette();
      }}
    >
      <TooltipProvider delayDuration={450}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Search files"
                title="Search files"
                aria-keyshortcuts="Meta+K Control+K"
                onClick={() => void useSearchStore.getState().openSearch(props.path)}
              >
                <Search size={18} />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Search files (⌘K)</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        align="end"
        sideOffset={6}
        className={toolbarStyles.palette}
        aria-label={commandMode ? "Explorer commands" : "Explorer locations"}
      >
        <Command shouldFilter={false} loop>
          <CommandInput
            autoFocus
            value={commandMode ? props.commandQuery.trimStart().slice(1) : props.commandQuery}
            placeholder={commandMode ? "Type a command…" : "Search locations…"}
            onValueChange={(value) => props.onCommandQuery(commandMode ? `>${value}` : value)}
          />
          <CommandList className="max-h-[min(420px,calc(100vh-120px))]">
            {commandMode ? (
              <>
                <CommandEmpty>No explorer commands found.</CommandEmpty>
                <CommandGroup heading="Commands">
                  {filteredCommands.map((command) => (
                    <CommandItem
                      key={command.id}
                      value={command.id}
                      className={toolbarStyles.paletteButton}
                      onSelect={() => runCommand(command.id)}
                    >
                      <CommandIcon />
                      <span className={toolbarStyles.paletteText}>
                        <span className={toolbarStyles.paletteTitle}>{command.label}</span>
                        <span className={toolbarStyles.paletteSubtitle}>
                          {command.group === "Extension" && command.pluginName
                            ? `${command.pluginName} · ${command.hint}`
                            : command.hint}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : (
              <LocationResults
                locations={filteredLocations}
                indexedResults={indexedResults}
                searching={indexedSearching}
                error={indexedError}
                onLocation={runLocation}
                onResult={runIndexedResult}
              />
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function LocationResults(props: {
  locations: ExplorerLocationResult[];
  indexedResults: SearchResult[];
  searching: boolean;
  error: string | null;
  onLocation: (path: string) => void;
  onResult: (result: SearchResult) => void;
}) {
  const empty = props.locations.length === 0 && props.indexedResults.length === 0;
  return (
    <>
      {props.locations.length > 0 ? (
        <CommandGroup heading="Locations">
          {props.locations.map((location) => (
            <CommandItem
              key={location.id}
              value={`location:${location.id}`}
              className={toolbarStyles.paletteButton}
              onSelect={() => props.onLocation(location.path)}
            >
              <Folder />
              <span className={toolbarStyles.paletteText}>
                <span className={toolbarStyles.paletteTitle}>{location.label}</span>
                <span className={toolbarStyles.paletteSubtitle}>
                  {location.badge} · {location.subtitle}
                </span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
      {props.locations.length > 0 && props.indexedResults.length > 0 ? <CommandSeparator /> : null}
      {props.indexedResults.length > 0 ? (
        <CommandGroup heading="Files">
          {props.indexedResults.map((result) => (
            <CommandItem
              key={`${result.sourceKind}:${result.entry.path}`}
              value={`file:${result.entry.path}`}
              className={toolbarStyles.paletteResultButton}
              onSelect={() => props.onResult(result)}
            >
              <SearchResultThumbnail
                result={result}
                className={toolbarStyles.paletteThumbnail}
                imageClassName={toolbarStyles.paletteThumbnailImage}
              />
              <span className={toolbarStyles.paletteText}>
                <span className={toolbarStyles.paletteTitle}>{result.entry.name}</span>
                <span className={toolbarStyles.paletteSummary}>{searchResultSummary(result)}</span>
                <span className={toolbarStyles.paletteSubtitle}>{searchResultContext(result)}</span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
      {empty ? (
        <CommandEmpty>
          {props.searching
            ? "Searching index…"
            : props.error
              ? "Search index unavailable."
              : "No matching locations or files."}
        </CommandEmpty>
      ) : null}
    </>
  );
}
