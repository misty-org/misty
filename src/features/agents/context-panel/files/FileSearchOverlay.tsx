// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconButton, Input, ChoiceGroup, SkeletonList } from "@/shared/ui";
import { errorText } from "../projectApi";
import { filesApi, type SearchHit } from "./filesApi";
import { useFileIndex, type IndexEntry } from "./fileIndex";
import { getFileTreeIconSvg } from "./fileIcons";
import { searchEntries, workspaceRelativePrefix } from "./fileSearch";
import { fileName, joinPath, useFilesStore, type SearchMode } from "./filesStore";

interface Row {
  key: string;
  name: string;
  /** The folder it is in, or the matching line for a text hit. */
  detail: string;
  isDir: boolean;
  activate(): void;
}

const TEXT_DEBOUNCE_MS = 250;

/**
 * Search over the tree, scoped to one folder: by name, ranked name first, from the folder's
 * index (one walk, kept a minute), or through the files' text. Escape closes; the input keeps
 * focus, so the pointer and the keys both work without moving focus around.
 */
export function FileSearchOverlay({ searchRoot }: { searchRoot: string }) {
  const root = useFilesStore((state) => state.root);
  const mode = useFilesStore((state) => state.searchMode);
  const closeSearch = useFilesStore((state) => state.closeSearch);
  const index = useFileIndex((state) => (root ? state.byRoot[root] : undefined));
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (root && mode === "files") useFileIndex.getState().ensure(root);
  }, [root, mode]);
  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  // The text search asks natively once typing pauses.
  useEffect(() => {
    if (mode !== "text") return;
    const needle = query.trim();
    if (!needle) {
      setHits([]);
      return;
    }
    let live = true;
    setHits(null);
    const timer = window.setTimeout(() => {
      void filesApi
        .searchText(searchRoot, needle)
        .then((found) => live && setHits(found))
        .catch((reason) => {
          if (!live) return;
          setHits([]);
          setError(errorText(reason));
        });
    }, TEXT_DEBOUNCE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [mode, query, searchRoot]);

  const activateEntry = useCallback(
    (entry: IndexEntry) => {
      const absolute = joinPath(root, entry.rel);
      const store = useFilesStore.getState();
      if (entry.isDir) {
        void store.revealDir(absolute);
        store.selectPath(absolute, true);
      } else {
        void store.openFile(absolute);
      }
      closeSearch();
    },
    [root, closeSearch],
  );

  const rows = useMemo<Row[]>(() => {
    if (mode === "files") {
      return searchEntries(index?.entries ?? [], root, searchRoot, query).map((entry) => ({
        key: entry.rel,
        name: entry.name,
        detail: entry.rel.slice(0, entry.rel.length - entry.name.length),
        isDir: entry.isDir,
        activate: () => activateEntry(entry),
      }));
    }
    return (hits ?? []).map((hit) => {
      return {
        key: `${hit.path}:${hit.line}`,
        name: `${fileName(hit.path)}:${hit.line}`,
        detail: hit.text,
        isDir: false,
        activate: () => {
          void useFilesStore.getState().openFile(hit.path);
          closeSearch();
        },
      };
    });
  }, [mode, index, root, searchRoot, query, hits, activateEntry, closeSearch]);

  const active = rows.length > 0 ? Math.min(activeIndex, rows.length - 1) : -1;

  // Keys live on the window, so the overlay stays keyboard-driven even if focus wanders.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case "Escape":
          event.preventDefault();
          closeSearch();
          return;
        case "ArrowDown":
          event.preventDefault();
          setActiveIndex((current) => Math.min(current + 1, Math.max(0, rows.length - 1)));
          return;
        case "ArrowUp":
          event.preventDefault();
          setActiveIndex((current) => Math.max(current - 1, 0));
          return;
        case "Enter": {
          const row = active >= 0 ? rows[active] : undefined;
          if (!row) return;
          event.preventDefault();
          row.activate();
          return;
        }
        default:
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rows, active, closeSearch]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, rows]);

  const scope = workspaceRelativePrefix(root, searchRoot);
  const searching =
    (mode === "files" && !index?.entries.length && index?.loading) ||
    (mode === "text" && hits === null && query.trim() !== "");

  return (
    <div className="file-search">
      <div className="file-search-bar">
        <Search size={15} className="shrink-0 text-cream-muted" aria-hidden />
        <Input
          variant="bare"
          ref={inputRef}
          className="file-search-input"
          aria-label={mode === "files" ? "Search files" : "Search in files"}
          placeholder={
            scope ? `${mode === "files" ? "Search files" : "Search text"} in ${scope}` : undefined
          }
          value={query}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
        />
        <ChoiceGroup<SearchMode>
          label="Search by"
          size="sm"
          value={mode}
          options={[
            { value: "files", label: "Names" },
            { value: "text", label: "Text" },
          ]}
          onChange={(next) => {
            useFilesStore.getState().openSearch(searchRoot, next);
            setActiveIndex(0);
          }}
        />
        <IconButton label="Close search" size="sm" onClick={closeSearch}>
          <X aria-hidden />
        </IconButton>
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label={mode === "files" ? "Matching files" : "Matching lines"}
        className="file-search-list"
      >
        {searching ? (
          <SkeletonList label="Searching" rows={5} leading="icon" lines={1} />
        ) : rows.length === 0 ? (
          query.trim() ? (
            <p className="file-search-empty">No matches.</p>
          ) : null
        ) : (
          rows.map((row, position) => (
            <div
              key={row.key}
              role="option"
              aria-selected={position === active}
              data-active={position === active || undefined}
              tabIndex={-1}
              className="file-search-row"
              // Focus stays in the input so typing never stops; the click still opens the row.
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => position !== active && setActiveIndex(position)}
              onClick={row.activate}
            >
              <span
                className="file-tree-icon"
                aria-hidden
                dangerouslySetInnerHTML={{ __html: getFileTreeIconSvg(row.name, row.isDir) }}
              />
              <span className="file-search-name">{row.name}</span>
              {row.detail ? <span className="file-search-detail">{row.detail}</span> : null}
            </div>
          ))
        )}
      </div>
      {error ? (
        <p className="file-search-empty" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
