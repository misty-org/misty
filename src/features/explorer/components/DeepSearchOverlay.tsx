import { Database, Loader2, RefreshCcw, Search, X } from "lucide-react";
import { memo, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import type { SearchQueryScope, SearchResult } from "../../../api/types";
import { formatBytes, formatDate } from "../utils/fileFormat";
import { useSearchStore } from "../state/useSearchStore";
import { revealSearchResultInPane, searchResultNavigationTarget } from "../utils/searchNavigation";

const scopeOptions: Array<{ value: SearchQueryScope; label: string }> = [
  { value: "everything", label: "All" },
  { value: "current", label: "Here" },
  { value: "local", label: "Local" },
  { value: "remotes", label: "Remotes" },
];

const overlayStyles = {
  scrim: "fixed inset-0 z-[1000] grid place-items-start justify-center bg-black/45 px-4 pt-[9vh] backdrop-blur-[2px]",
  panel:
    "grid w-[min(760px,calc(100vw-28px))] max-h-[78vh] grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden rounded-xl border border-[#363636] bg-[#101010] shadow-[0_26px_70px_rgba(0,0,0,0.54)]",
  header: "grid grid-cols-[1fr_auto] items-center gap-3 border-b border-[#292929] px-3 py-2",
  searchBox:
    "grid h-10 min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-[#333333] bg-[#181818] px-3 text-[#a8a8a8]",
  input:
    "h-full min-w-0 border-0 bg-transparent p-0 text-[15px] text-[#eeeeee] outline-none placeholder:text-[#777777]",
  iconButton:
    "grid size-8 place-items-center rounded-md border border-transparent bg-transparent text-[#a5a5a5] hover:border-[#3a3a3a] hover:bg-[#1e1e1e] hover:text-[#eeeeee]",
  controls:
    "flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[#292929] px-3 py-2",
  scopes: "flex min-w-0 items-center gap-1 rounded-lg bg-[#181818] p-1",
  scope:
    "h-7 rounded-md border-0 bg-transparent px-2.5 text-sm text-[#a7a7a7] hover:bg-[#252525] hover:text-[#eeeeee]",
  scopeActive: "bg-[#303030] text-[#f0f0f0]",
  scanActions: "flex min-w-0 items-center gap-2",
  scanButton:
    "inline-flex h-8 items-center gap-2 rounded-lg border border-[#383838] bg-[#1a1a1a] px-3 text-sm text-[#dedede] hover:bg-[#232323] disabled:opacity-55",
  status: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap px-3 py-1.5 text-xs text-[#969696]",
  results: "min-h-0 overflow-auto py-1",
  result:
    "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-0 bg-transparent px-3 py-2 text-left text-[#dfdfdf] hover:bg-[#1d1d1d]",
  resultIcon:
    "grid size-8 place-items-center rounded-md border border-[#303030] bg-[#171717] text-xs font-semibold text-[#a9c8ff]",
  resultText: "grid min-w-0 gap-0.5",
  resultName: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold",
  resultPath: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-[#929292]",
  resultMeta: "text-right text-xs text-[#8f8f8f]",
  empty: "px-4 py-9 text-center text-sm text-[#9a9a9a]",
  footer:
    "flex min-h-9 items-center justify-between gap-3 border-t border-[#292929] px-3 text-xs text-[#898989]",
  error: "text-[#d6a0a0]",
} as const;

interface DeepSearchOverlayProps {
  activePaneId: string;
  currentPath: string;
}

export const DeepSearchOverlay = memo(function DeepSearchOverlay(props: DeepSearchOverlayProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { open, query, scope, results, searching, status, error } = useSearchStore(useShallow((state) => ({
    open: state.open,
    query: state.query,
    scope: state.scope,
    results: state.results,
    searching: state.searching,
    status: state.status,
    error: state.error,
  })));

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") useSearchStore.getState().closeSearch();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  const scanActive = Boolean(status?.scanInProgress);
  const indexedCount = status?.indexedItemCount ?? 0;
  const statusText = scanActive
    ? `${status?.scanPhase ?? "scanning"} ${status?.scanIndexedItemCount ?? 0} items${status?.currentPath ? ` · ${status.currentPath}` : ""}`
    : indexedCount > 0
      ? `${indexedCount.toLocaleString()} indexed items${status?.lastScanTimeMs ? ` · indexed ${formatDate(status.lastScanTimeMs)}` : ""}`
      : "No search index yet";

  return (
    <div className={overlayStyles.scrim} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) useSearchStore.getState().closeSearch();
    }}>
      <section className={overlayStyles.panel} role="dialog" aria-modal="true" aria-label="Deep search">
        <header className={overlayStyles.header}>
          <label className={overlayStyles.searchBox}>
            <Search size={17} />
            <input
              ref={inputRef}
              className={overlayStyles.input}
              value={query}
              placeholder="Search files and folders"
              onChange={(event) => useSearchStore.getState().setQuery(event.target.value)}
            />
          </label>
          <button className={overlayStyles.iconButton} type="button" aria-label="Close search" onClick={() => useSearchStore.getState().closeSearch()}>
            <X size={18} />
          </button>
        </header>
        <div className={overlayStyles.controls}>
          <div className={overlayStyles.scopes} role="tablist" aria-label="Search scope">
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
          </div>
          <div className={overlayStyles.scanActions}>
            {scanActive ? (
              <button className={overlayStyles.scanButton} type="button" onClick={() => void useSearchStore.getState().cancelScan()}>
                <Loader2 size={15} className="animate-spin" /> Cancel
              </button>
            ) : (
              <button className={overlayStyles.scanButton} type="button" onClick={() => void useSearchStore.getState().startScan(props.currentPath)}>
                {indexedCount > 0 ? <RefreshCcw size={15} /> : <Database size={15} />} {indexedCount > 0 ? "Rescan" : "Index"}
              </button>
            )}
          </div>
        </div>
        <div className={overlayStyles.results}>
          {results.length > 0 ? results.map((result) => (
            <SearchResultRow
              key={`${result.sourceKind}:${result.entry.path}`}
              result={result}
              activePaneId={props.activePaneId}
            />
          )) : (
            <div className={overlayStyles.empty}>
              {query.trim()
                ? searching
                  ? "Searching..."
                  : indexedCount > 0
                    ? "No results"
                    : "Create an index to search deeply"
                : "Type to search the index"}
            </div>
          )}
        </div>
        <footer className={overlayStyles.footer}>
          <span className={error ? overlayStyles.error : ""}>{error || statusText}</span>
          <span>{searching ? "Searching..." : `${results.length} results`}</span>
        </footer>
      </section>
    </div>
  );
});

function SearchResultRow(props: { result: SearchResult; activePaneId: string }) {
  const { result } = props;
  const entry = result.entry;
  const source = entry.location.kind === "remote"
    ? entry.location.remoteName ?? "Remote"
    : "Local";
  const meta = [
    source,
    entry.kind,
    entry.sizeBytes !== null ? formatBytes(entry.sizeBytes) : "",
  ].filter(Boolean).join(" · ");
  return (
    <button
      className={overlayStyles.result}
      type="button"
      onClick={() => {
        void revealSearchResultInPane(props.activePaneId, searchResultNavigationTarget(result));
        useSearchStore.getState().closeSearch();
      }}
    >
      <span className={overlayStyles.resultIcon}>{entry.kind === "folder" ? "DIR" : "FILE"}</span>
      <span className={overlayStyles.resultText}>
        <span className={overlayStyles.resultName}>{entry.name}</span>
        <span className={overlayStyles.resultPath}>{entry.path}</span>
      </span>
      <span className={overlayStyles.resultMeta}>{meta}</span>
    </button>
  );
}
