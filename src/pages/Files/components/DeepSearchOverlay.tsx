import { CornerDownLeft, ListFilter, Loader2, Search } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { SearchQueryScope, SearchResult } from "../../../api/types";
import { formatBytes, formatDate } from "../utils/fileFormat";
import { useSearchStore } from "../../../stores/useSearchStore";
import { revealSearchResultInPane, searchResultNavigationTarget } from "../utils/searchNavigation";
import { searchResultContext, searchResultSummary } from "./ExplorerToolbarSupport";
import { SearchResultThumbnail } from "./SearchResultThumbnail";
import { useExplorerStore } from "../../../stores/useExplorerStore";
import { compileEntryFilterMatcher, entryMatchesQuery } from "./FileBrowserFilters";

const scopeOptions: Array<{ value: SearchQueryScope; label: string }> = [
  { value: "everything", label: "All" },
  { value: "current", label: "Here" },
  { value: "local", label: "Local" },
  { value: "remotes", label: "Remotes" },
];
const emptyPaneEntries: SearchResult["entry"][] = [];

const overlayStyles = {
  scrim: "fixed inset-0 z-[2147482950] grid place-items-start justify-center bg-black/30 px-4 pt-[clamp(58px,14vh,150px)] backdrop-blur-[5px]",
  panel:
    "grid w-[min(860px,calc(100vw-28px))] max-h-[min(650px,calc(100vh-86px))] grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden rounded-[26px] border border-white/[0.16] bg-[rgba(24,25,28,0.94)] shadow-[0_38px_110px_rgba(0,0,0,0.68)] backdrop-blur-[44px]",
  header: "grid min-h-[74px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5",
  searchBox:
    "grid h-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-4 text-[#a5a8ae]",
  input:
    "h-full min-w-0 border-0 bg-transparent p-0 text-[24px] font-medium tracking-[-0.025em] text-[#f3f4f6] outline-none placeholder:text-[#74777e]",
  keyHint: "rounded-lg border border-white/[0.1] bg-white/[0.055] px-2 py-1 text-[11px] font-semibold text-[#8f939b]",
  controls:
    "flex min-w-0 flex-wrap items-center gap-2 border-y border-white/[0.09] px-5 py-3",
  scopes: "flex min-w-0 flex-wrap items-center gap-2",
  scope:
    "h-8 rounded-xl border border-transparent bg-white/[0.055] px-3 text-[13px] font-medium text-[#a5a8ae] hover:bg-white/[0.09] hover:text-[#f4f4f5]",
  scopeActive: "border-white/[0.1] bg-white/[0.13] text-[#f4f4f5]",
  status: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-3 py-1.5 text-xs text-[#8f8f8f]",
  results: "min-h-[148px] overflow-auto p-2.5",
  result:
    "grid min-h-[68px] w-full grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 rounded-[15px] border-0 bg-transparent px-3 py-2 text-left text-[#e4e4e7]",
  resultSelected: "bg-white/[0.16] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]",
  resultIcon:
    "grid size-12 place-items-center overflow-hidden rounded-[11px] border border-white/[0.1] bg-black/20 text-[#d4d4d8]",
  resultImage: "size-full object-cover",
  resultText: "grid min-w-0 gap-0.5 leading-tight",
  resultName: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-semibold text-[#f0f1f3]",
  resultSummary: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-[#b4b7be]",
  resultPath: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-[#7e828a]",
  resultMeta: "hidden text-right text-xs text-[#858992] sm:block",
  empty: "grid min-h-[148px] place-items-center px-5 py-9 text-center text-sm text-[#8f939a]",
  footer:
    "flex min-h-10 items-center justify-between gap-3 border-t border-white/[0.08] px-5 text-[11px] text-[#777b83]",
  error: "text-[#d6a0a0]",
} as const;

interface DeepSearchOverlayProps {
  activePaneId: string;
  currentPath: string;
}

export const DeepSearchOverlay = memo(function DeepSearchOverlay(props: DeepSearchOverlayProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<"search" | "filter">("search");
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { open, query, scope, results, searching, status, error } = useSearchStore(useShallow((state) => ({
    open: state.open,
    query: state.query,
    scope: state.scope,
    results: state.results,
    searching: state.searching,
    status: state.status,
    error: state.error,
  })));
  const paneEntries = useExplorerStore((state) => state.panes[props.activePaneId]?.listing?.entries ?? emptyPaneEntries);
  const filterResults = useMemo<SearchResult[]>(() => {
    const matcher = compileEntryFilterMatcher(filterQuery.trim());
    if (!matcher) return [];
    return paneEntries.filter((entry) => entryMatchesQuery(entry, matcher)).map((entry, index) => ({ entry, score: 1 - index / Math.max(1, paneEntries.length), sourceKind: entry.location.kind === "remote" ? "remote" : "local", indexedAtMs: Date.now(), match: { kind: "filename" } }));
  }, [filterQuery, paneEntries]);
  const displayedResults = mode === "search" ? results : filterResults;

  const openResult = useCallback(async (result: SearchResult) => {
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
  }, [location.pathname, navigate, props.activePaneId]);

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
      if (event.key === "Escape") {
        event.preventDefault();
        useSearchStore.getState().closeSearch();
      } else if (event.key === "ArrowDown" && displayedResults.length > 0) {
        event.preventDefault();
        setSelectedIndex((index) => (index + 1) % displayedResults.length);
      } else if (event.key === "ArrowUp" && displayedResults.length > 0) {
        event.preventDefault();
        setSelectedIndex((index) => (index - 1 + displayedResults.length) % displayedResults.length);
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
    document.querySelector(`[data-spotlight-index="${selectedIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, selectedIndex]);

  if (!open) return null;

  const scanActive = Boolean(status?.scanInProgress);
  const indexedCount = status?.indexedItemCount ?? 0;
  const statusText = scanActive
    ? `Misty is checking for new files · ${(status?.scanIndexedItemCount ?? 0).toLocaleString()} checked`
    : indexedCount > 0
      ? `${indexedCount.toLocaleString()} files available${status?.lastScanTimeMs ? ` · updated ${formatDate(status.lastScanTimeMs)}` : ""}`
      : "Misty is preparing file search · image understanding remains available";

  return (
    <div className={overlayStyles.scrim} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) useSearchStore.getState().closeSearch();
    }}>
      <section className={overlayStyles.panel} role="dialog" aria-modal="true" aria-label="Deep search">
        <header className={overlayStyles.header}>
          <label className={overlayStyles.searchBox}>
            <Search size={28} strokeWidth={1.8} />
            <input
              ref={inputRef}
              className={overlayStyles.input}
              value={mode === "search" ? query : filterQuery}
              placeholder={mode === "search" ? "Search files by name, subject, text, or tag" : "Filter this folder with text, *, ?, or /regex/"}
              onChange={(event) => mode === "search" ? useSearchStore.getState().setQuery(event.target.value) : setFilterQuery(event.target.value)}
            />
          </label>
          <kbd className={overlayStyles.keyHint}>⌘K</kbd>
        </header>
        <div className={overlayStyles.controls}>
          <div className={overlayStyles.scopes} role="tablist" aria-label="Search mode">
            <button type="button" className={`${overlayStyles.scope} ${mode === "search" ? overlayStyles.scopeActive : ""}`} onClick={() => setMode("search")}><span className="inline-flex items-center gap-1.5"><Search size={13} />Find all</span></button>
            <button type="button" className={`${overlayStyles.scope} ${mode === "filter" ? overlayStyles.scopeActive : ""}`} onClick={() => setMode("filter")}><span className="inline-flex items-center gap-1.5"><ListFilter size={13} />Filter folder</span></button>
          </div>
          {mode === "search" ? <div className={overlayStyles.scopes} role="tablist" aria-label="Search scope">
            {scopeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`${overlayStyles.scope} ${scope === option.value ? overlayStyles.scopeActive : ""}`}
                onClick={() => useSearchStore.getState().setScope(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div> : <span className="text-xs text-[#858585]">{filterResults.length} matching items in this folder</span>}
        </div>
        <div className={overlayStyles.results}>
          {displayedResults.length > 0 ? displayedResults.map((result, index) => (
            <SearchResultRow
              key={`${result.sourceKind}:${result.entry.path}:${result.match?.mediaSegmentId ?? "file"}`}
              result={result}
              index={index}
              selected={index === selectedIndex}
              onHover={() => setSelectedIndex(index)}
              onOpen={() => void openResult(result)}
            />
          )) : (
            <div className={overlayStyles.empty}>
              {(mode === "search" ? query : filterQuery).trim()
                ? searching
                  ? "Searching..."
                  : indexedCount > 0
                    ? "No results"
                    : "No semantic results · create a local index for filename search"
                : mode === "search" ? "Search filenames or describe what a file contains" : "Type to filter the current folder"}
            </div>
          )}
        </div>
        <footer className={overlayStyles.footer}>
          <span className={error ? overlayStyles.error : ""}>{error || statusText}</span>
          <span className="inline-flex items-center gap-2">{mode === "search" && searching ? "Searching..." : `${displayedResults.length} results`}<span className="inline-flex items-center gap-1 text-[#92969e]"><CornerDownLeft size={12} /> open</span></span>
        </footer>
      </section>
    </div>
  );
});

function SearchResultRow(props: { result: SearchResult; index: number; selected: boolean; onHover: () => void; onOpen: () => void }) {
  const { result } = props;
  const entry = result.entry;
  const meta = [
    entry.sizeBytes !== null ? formatBytes(entry.sizeBytes) : "",
    entry.modifiedMs !== null ? formatDate(entry.modifiedMs) : "",
  ].filter(Boolean).join(" · ");
  return (
    <button
      data-spotlight-index={props.index}
      className={`${overlayStyles.result} ${props.selected ? overlayStyles.resultSelected : "hover:bg-white/[0.08]"}`}
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
    </button>
  );
}
