import type { PluginCommandEntry, SearchResult } from "@/native/contracts";
import { SystemErrorActivity } from "@/features/activity";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Popover,
  PopoverContent,
} from "@/shared/ui";
import { Folder } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExplorerLocationResult } from "../model/interfaces/components/ExplorerToolbarModel";
import type { ExplorerSearchNavigationTarget } from "../model/interfaces/utils/searchNavigation";
import { useSearchStore } from "@/features/files/search";
import { useExplorerStore, type ExplorerCommandQueryMode } from "../store";
import {
  mergeHybridSearchResults,
  queryIndexedExplorerSearch,
  querySemanticExplorerSearch,
  semanticQueryMinimumCharacters,
  semanticSearchDebounceMs,
} from "../utils/globalSearch";
import { searchResultNavigationTarget } from "../utils/searchNavigation";
import {
  fuzzyIncludes,
  searchResultContext,
  searchResultSummary,
  toolbarStyles,
} from "./ExplorerToolbarSupport";
import { SearchResultThumbnail } from "./SearchResultThumbnail";

export function ExplorerToolbarSearch(props: ExplorerToolbarSearchProps) {
  const [searchFocused, setSearchFocused] = useState(false);
  const [indexedResults, setIndexedResults] = useState<SearchResult[]>([]);
  const [indexedSearching, setIndexedSearching] = useState(false);
  const [indexedError, setIndexedError] = useState<string | null>(null);
  const indexedNativeResultsRef = useRef<SearchResult[]>([]);
  const indexedSemanticResultsRef = useRef<SearchResult[]>([]);
  const searchMode = props.commandQueryMode === "search";
  const locationFilter = searchMode ? props.commandQuery.trim().toLowerCase() : "";
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
    Boolean(locationFilter) &&
    (filteredLocations.length > 0 ||
      indexedResults.length > 0 ||
      indexedSearching ||
      Boolean(indexedError));
  const paletteOpen = locationMode;

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

  const closePalette = () => setSearchFocused(false);
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
      <PopoverContent
        align="end"
        sideOffset={6}
        className={toolbarStyles.palette}
        aria-label="Explorer locations"
      >
        <Command shouldFilter={false} loop>
          <CommandInput
            autoFocus
            value={props.commandQuery}
            placeholder="Search locations…"
            onValueChange={(value) => props.onCommandQuery(value)}
          />
          <CommandList className="max-h-[min(420px,calc(100vh-120px))]">
            <LocationResults
              locations={filteredLocations}
              indexedResults={indexedResults}
              searching={indexedSearching}
              error={indexedError}
              onLocation={runLocation}
              onResult={runIndexedResult}
            />
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
      {props.error ? (
        <SystemErrorActivity
          error={props.error}
          scope="files:toolbar-search"
          title="File search could not be completed"
          target={{ kind: "workspace-tool", tool: "files" }}
        />
      ) : null}
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
