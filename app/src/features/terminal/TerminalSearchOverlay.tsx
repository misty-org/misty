import type { SearchAddon } from "@xterm/addon-search";
import { Search, X } from "lucide-react";
import { useState } from "react";

interface Props {
  search: SearchAddon;
  onClose: () => void;
}

/** Compact search overlay pinned to the top-right of a terminal pane. Owns
 *  its own query state so the parent doesn't re-render on every keystroke. */
export function TerminalSearchOverlay({ search, onClose }: Props) {
  const [query, setQuery] = useState("");
  return (
    <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-md border border-charcoal-border bg-charcoal-card px-2 py-1 shadow-lg">
      <Search size={12} className="text-cream-muted" />
      <input
        autoFocus
        value={query}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          if (next) search.findNext(next, { incremental: true });
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            search.clearDecorations();
            onClose();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) search.findPrevious(query);
            else search.findNext(query);
          }
        }}
        placeholder="Search…"
        className="h-6 w-56 bg-transparent text-[12px] text-cream outline-none placeholder:text-cream-muted"
      />
      <button
        type="button"
        className="grid size-5 place-items-center rounded text-cream-muted hover:bg-charcoal-hover hover:text-cream"
        onClick={() => search.findPrevious(query)}
        aria-label="Previous match"
      >
        ↑
      </button>
      <button
        type="button"
        className="grid size-5 place-items-center rounded text-cream-muted hover:bg-charcoal-hover hover:text-cream"
        onClick={() => search.findNext(query)}
        aria-label="Next match"
      >
        ↓
      </button>
      <button
        type="button"
        className="grid size-5 place-items-center rounded text-cream-muted hover:bg-charcoal-hover hover:text-cream"
        onClick={() => {
          search.clearDecorations();
          onClose();
        }}
        aria-label="Close search"
      >
        <X size={11} />
      </button>
    </div>
  );
}
