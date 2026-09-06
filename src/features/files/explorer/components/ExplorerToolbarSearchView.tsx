import type { PluginCommandEntry, SearchResult } from "@/native/contracts";
import type { ComponentType, ComponentProps } from "react";
import type { SystemErrorActivity } from "@/features/activity";
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
import { useEffect, useMemo, useState } from "react";
import type { ExplorerLocationResult } from "../model/interfaces/components/ExplorerToolbarModel";
import type { ExplorerSearchNavigationTarget } from "../model/interfaces/utils/searchNavigation";
import type { ExplorerCommandQueryMode } from "../model/types/store/types";
import {
  fuzzyIncludes,
  searchResultContext,
  searchResultSummary,
  toolbarStyles,
} from "./ExplorerToolbarSupport";
import type { SearchResultThumbnail } from "./SearchResultThumbnail";
export interface ExplorerToolbarSearchRuntime {
  query(query: string, path: string, signal: AbortSignal): Promise<SearchResult[]>;
  openSearch(path: string): void;
  Error: ComponentType<ComponentProps<typeof SystemErrorActivity>>;
  Thumbnail: ComponentType<ComponentProps<typeof SearchResultThumbnail>>;
}

export function ExplorerToolbarSearchView(props: ExplorerToolbarSearchProps & { runtime: ExplorerToolbarSearchRuntime }) {
  const [searchFocused, setSearchFocused] = useState(false);
  const [indexedResults, setIndexedResults] = useState<SearchResult[]>([]);
  const [indexedSearching, setIndexedSearching] = useState(false);
  const [indexedError, setIndexedError] = useState<string | null>(null);
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
    const lifetime = new AbortController();
    const query = locationFilter.trim();
    setIndexedResults([]);
    setIndexedError(null);
    setIndexedSearching(Boolean(query));
    if (!query) return;
    const timer = window.setTimeout(() => {
      void props.runtime.query(query, props.path, lifetime.signal).then(results => {
        if (!lifetime.signal.aborted) setIndexedResults(results);
      }).catch(error => {
        if (!lifetime.signal.aborted) setIndexedError(String(error));
      }).finally(() => {
        if (!lifetime.signal.aborted) setIndexedSearching(false);
      });
    }, 160);
    return () => { lifetime.abort(); window.clearTimeout(timer); };
  }, [locationFilter, props.path, props.runtime]);

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
      props.runtime.openSearch(props.path);
    };
    window.addEventListener("misty:explorer-search-focus", onSearchFocus);
    return () => window.removeEventListener("misty:explorer-search-focus", onSearchFocus);
  }, [props.paneId, props.path, props.runtime]);

  const closePalette = () => setSearchFocused(false);
  const runLocation = (path: string) => {
    props.onNavigateLocation(path);
    props.onCommandQuery("");
    setSearchFocused(false);
  };
  const runIndexedResult = (result: SearchResult) => {
    props.onNavigateSearchResult({result, path: result.entry.kind === "folder" ? result.entry.path : result.entry.path.slice(0, result.entry.path.lastIndexOf("/")), selectEntryId: result.entry.kind === "folder" ? null : result.entry.id});
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
              runtime={props.runtime}
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
  runtime: ExplorerToolbarSearchRuntime;
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
        <props.runtime.Error
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
              <props.runtime.Thumbnail
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
            ? "Searching files…"
            : props.error
              ? "Search unavailable."
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
