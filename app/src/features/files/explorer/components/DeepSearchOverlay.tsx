import type { SearchResult } from "@/native/contracts";
import type { SearchQueryScope } from "@/native/contracts/primitives";
import { ShortcutHint } from "@/features/shortcuts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/shared/ui";
import { CornerDownLeft, ListFilter, Loader2, Search } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useSearchStore } from "@/features/files/search";
import { useExplorerStore } from "../store";
import { formatBytes, formatDate } from "../utils/fileFormat";
import { revealSearchResultInPane, searchResultNavigationTarget } from "../utils/searchNavigation";
import { searchResultContext, searchResultSummary } from "./ExplorerToolbarSupport";
import { compileEntryFilterMatcher, entryMatchesQuery } from "./FileBrowserFilters";
import { SearchResultThumbnail } from "./SearchResultThumbnail";

const scopeOptions: Array<{ value: SearchQueryScope; label: string }> = [
  { value: "everything", label: "All" },
  { value: "current", label: "Here" },
  { value: "local", label: "Local" },
  { value: "remotes", label: "Remotes" },
];
const emptyPaneEntries: SearchResult["entry"][] = [];

const overlayStyles = {
  panel:
    "left-1/2 top-[clamp(58px,14vh,150px)] grid max-h-[min(650px,calc(100vh-86px))] w-[min(680px,calc(100vw-28px))] max-w-none translate-x-[-50%] translate-y-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-xl border-charcoal-border bg-charcoal-card p-0 text-cream shadow-2xl [&>button]:hidden",
  header: "grid min-h-[74px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5",
  searchBox:
    "grid h-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-4 text-cream-muted",
  input:
    "h-full min-w-0 border-0 bg-transparent p-0 text-xl font-medium tracking-tight text-cream shadow-none outline-none placeholder:text-cream-muted focus-visible:ring-0",
  keyHint:
    "rounded-md border border-charcoal-border bg-charcoal-card px-2 py-1 text-[11px] font-medium text-cream-muted",
  controls:
    "flex min-w-0 flex-wrap items-center gap-2 border-y border-charcoal-border/80 bg-charcoal-card px-5 py-2.5",
  scopes: "flex min-w-0 flex-wrap items-center gap-2",
  scope: "h-8 rounded-md px-3 text-xs font-medium text-cream-muted",
  scopeActive: "bg-charcoal-hover text-cream",
  status:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-3 py-1.5 text-xs text-cream-muted",
  results: "min-h-[148px] overflow-auto p-2.5",
  result:
    "grid min-h-[64px] w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-cream shadow-none",
  resultSelected: "bg-charcoal-hover text-cream hover:bg-charcoal-hover hover:text-cream",
  resultIcon:
    "grid size-11 place-items-center overflow-hidden rounded-md bg-charcoal-card text-cream-muted",
  resultImage: "size-full object-cover",
  resultText: "grid min-w-0 gap-0.5 leading-tight",
  resultName:
    "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-cream",
  resultSummary: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-cream-muted",
  resultPath: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-cream-muted/75",
  resultMeta: "hidden text-right text-xs text-cream-muted sm:block",
  empty: "grid min-h-[148px] place-items-center px-5 py-9 text-center text-sm text-cream-muted",
  footer:
    "flex min-h-10 items-center justify-between gap-3 border-t border-charcoal-border/80 bg-charcoal-card px-5 text-[11px] text-cream-muted",
  error: "text-cream-bright",
} as const;

export const DeepSearchOverlay = memo(function DeepSearchOverlay(props: DeepSearchOverlayProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<"search" | "filter">("search");
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { open, query, scope, results, searching, status, error } = useSearchStore(
    useShallow((state) => ({
      open: state.open,
      query: state.query,
      scope: state.scope,
      results: state.results,
      searching: state.searching,
      status: state.status,
      error: state.error,
    })),
  );
  const paneEntries = useExplorerStore(
    (state) => state.panes[props.activePaneId]?.listing?.entries ?? emptyPaneEntries,
  );
  const filterResults = useMemo<SearchResult[]>(() => {
    const matcher = compileEntryFilterMatcher(filterQuery.trim());
    if (!matcher) return [];
    return paneEntries
      .filter((entry) => entryMatchesQuery(entry, matcher))
      .map((entry, index) => ({
        entry,
        score: 1 - index / Math.max(1, paneEntries.length),
        sourceKind: entry.location.kind === "remote" ? "remote" : "local",
        indexedAtMs: Date.now(),
        match: { kind: "filename" },
      }));
  }, [filterQuery, paneEntries]);
  const displayedResults = mode === "search" ? results : filterResults;

  const openResult = useCallback(
    async (result: SearchResult) => {
      useSearchStore.getState().closeSearch();
      if (!location.pathname.startsWith("/files")) navigate("/files");
      const reveal = async (): Promise<boolean> => {
        const paneId = props.activePaneId || Object.keys(useExplorerStore.getState().panes)[0];
        if (!paneId) return false;
        await revealSearchResultInPane(paneId, searchResultNavigationTarget(result));
        return true;
      };
      if (await reveal()) return;
      let attempts = 0;
      const retry = window.setInterval(() => {
        attempts += 1;
        void reveal().then((revealed) => {
          if (revealed || attempts >= 20) window.clearInterval(retry);
        });
      }, 75);
    },
    [location.pathname, navigate, props.activePaneId],
  );

  useEffect(() => {
    if (!open) return;
    setSelectedIndex(0);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open]);

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(0, displayedResults.length - 1)));
  }, [displayedResults.length, mode, query, filterQuery]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" && displayedResults.length > 0) {
        event.preventDefault();
        setSelectedIndex((index) => (index + 1) % displayedResults.length);
      } else if (event.key === "ArrowUp" && displayedResults.length > 0) {
        event.preventDefault();
        setSelectedIndex(
          (index) => (index - 1 + displayedResults.length) % displayedResults.length,
        );
      } else if (event.key === "Enter" && displayedResults[selectedIndex]) {
        event.preventDefault();
        void openResult(displayedResults[selectedIndex]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [displayedResults, open, openResult, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    document
      .querySelector(`[data-spotlight-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, selectedIndex]);

  const scanActive = Boolean(status?.scanInProgress);
  const indexedCount = status?.indexedItemCount ?? 0;
  const statusText = scanActive
    ? `Misty is checking for new files · ${(status?.scanIndexedItemCount ?? 0).toLocaleString()} checked`
    : indexedCount > 0
      ? `${indexedCount.toLocaleString()} files available${status?.lastScanTimeMs ? ` · updated ${formatDate(status.lastScanTimeMs)}` : ""}`
      : "Misty is preparing file search · image understanding remains available";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) useSearchStore.getState().closeSearch();
      }}
    >
      <DialogContent
        className={overlayStyles.panel}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
          inputRef.current?.select();
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Deep search</DialogTitle>
          <DialogDescription>
            Search every connected location or filter the current folder.
          </DialogDescription>
        </DialogHeader>
        <header className={overlayStyles.header}>
          <label className={overlayStyles.searchBox}>
            <Search size={28} strokeWidth={1.8} />
            <Input
              ref={inputRef}
              className={overlayStyles.input}
              value={mode === "search" ? query : filterQuery}
              placeholder={
                mode === "search"
                  ? "Search files by name, subject, text, or tag"
                  : "Filter this folder with text, *, ?, or /regex/"
              }
              onChange={(event) =>
                mode === "search"
                  ? useSearchStore.getState().setQuery(event.target.value)
                  : setFilterQuery(event.target.value)
              }
            />
          </label>
          <ShortcutHint commandId="explorer.search" className={overlayStyles.keyHint} />
        </header>
        <div className={overlayStyles.controls}>
          <div className={overlayStyles.scopes} role="tablist" aria-label="Search mode">
            <Button
              variant="ghost"
              type="button"
              className={`${overlayStyles.scope} ${mode === "search" ? overlayStyles.scopeActive : ""}`}
              onClick={() => setMode("search")}
            >
              <Search size={13} />
              Find all
            </Button>
            <Button
              variant="ghost"
              type="button"
              className={`${overlayStyles.scope} ${mode === "filter" ? overlayStyles.scopeActive : ""}`}
              onClick={() => setMode("filter")}
            >
              <ListFilter size={13} />
              Filter folder
            </Button>
          </div>
          {mode === "search" ? (
            <div className={overlayStyles.scopes} role="tablist" aria-label="Search scope">
              {scopeOptions.map((option) => (
                <Button
                  key={option.value}
                  variant="ghost"
                  type="button"
                  className={`${overlayStyles.scope} ${scope === option.value ? overlayStyles.scopeActive : ""}`}
                  onClick={() => useSearchStore.getState().setScope(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          ) : (
            <span className="text-xs text-cream-muted">
              {filterResults.length} matching items in this folder
            </span>
          )}
        </div>
        <div className={overlayStyles.results}>
          {displayedResults.length > 0 ? (
            displayedResults.map((result, index) => (
              <SearchResultRow
                key={`${result.sourceKind}:${result.entry.path}:${result.match?.mediaSegmentId ?? "file"}`}
                result={result}
                index={index}
                selected={index === selectedIndex}
                onHover={() => setSelectedIndex(index)}
                onOpen={() => void openResult(result)}
              />
            ))
          ) : (
            <div className={overlayStyles.empty}>
              {(mode === "search" ? query : filterQuery).trim()
                ? searching
                  ? "Searching..."
                  : indexedCount > 0
                    ? "No results"
                    : "No semantic results · create a local index for filename search"
                : mode === "search"
                  ? "Search filenames or describe what a file contains"
                  : "Type to filter the current folder"}
            </div>
          )}
        </div>
        <footer className={overlayStyles.footer}>
          <span className={error ? overlayStyles.error : ""}>{error || statusText}</span>
          <span className="inline-flex items-center gap-2">
            {mode === "search" && searching ? (
              <>
                <Loader2 className="animate-spin" size={12} />
                Searching...
              </>
            ) : (
              `${displayedResults.length} results`
            )}
            <span className="inline-flex items-center gap-1">
              <CornerDownLeft size={12} /> open
            </span>
          </span>
        </footer>
      </DialogContent>
    </Dialog>
  );
});

function SearchResultRow(props: {
  result: SearchResult;
  index: number;
  selected: boolean;
  onHover: () => void;
  onOpen: () => void;
}) {
  const { result } = props;
  const entry = result.entry;
  const meta = [
    entry.sizeBytes !== null ? formatBytes(entry.sizeBytes) : "",
    entry.modifiedMs !== null ? formatDate(entry.modifiedMs) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Button
      data-spotlight-index={props.index}
      variant="ghost"
      className={`${overlayStyles.result} ${props.selected ? overlayStyles.resultSelected : ""}`}
      type="button"
      aria-selected={props.selected}
      onMouseEnter={props.onHover}
      onClick={props.onOpen}
    >
      <SearchResultThumbnail
        result={result}
        className={overlayStyles.resultIcon}
        imageClassName={overlayStyles.resultImage}
      />
      <span className={overlayStyles.resultText}>
        <span className={overlayStyles.resultName}>{entry.name}</span>
        <span className={overlayStyles.resultSummary}>{searchResultSummary(result)}</span>
        <span className={overlayStyles.resultPath}>{searchResultContext(result)}</span>
      </span>
      <span className={overlayStyles.resultMeta}>{meta}</span>
    </Button>
  );
}

export interface DeepSearchOverlayProps {
  activePaneId: string;
  currentPath: string;
}
