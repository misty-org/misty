import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/shared/ui";
import { browserPageTools, type BrowserFindResult } from "../library/native";
import { browserToolbarButtonClass, browserToolbarStyles } from "./browserToolbarStyles";

/**
 * Find in page. It sits in its own row under the toolbar rather than over the
 * page, so the native page stays interactive while it is open.
 */
export function BrowserFindBar(props: {
  runtimeId: string;
  /** Bumped each time find is requested; opens and focuses the bar. */
  request: number;
  /** The page changed; stale highlights and counts no longer apply. */
  pageKey: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<BrowserFindResult | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    if (!props.request) return;
    setOpen(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [props.request]);

  useEffect(() => setResult(null), [props.pageKey]);

  const find = (direction: "next" | "previous" | "clear", text = query) => {
    const current = ++generation.current;
    void browserPageTools
      .find(props.runtimeId, text, direction)
      .then((next) => {
        if (current === generation.current) setResult(direction === "clear" ? null : next);
      })
      .catch(() => {
        if (current === generation.current) setResult({ current: 0, total: 0 });
      });
  };

  useEffect(() => {
    if (!open) return;
    if (!query) {
      find("clear", "");
      return;
    }
    const timer = window.setTimeout(() => find("next", query), 120);
    return () => window.clearTimeout(timer);
    // Searching again only when the text changes; arrows step through matches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open, props.pageKey]);

  const close = () => {
    setOpen(false);
    setQuery("");
    find("clear", "");
  };

  if (!open) return null;
  const iconButton = browserToolbarButtonClass(false);
  const noMatches = Boolean(query) && result?.total === 0;
  return (
    <div
      className="flex h-9 shrink-0 items-center justify-end gap-1 border-b border-white/[0.055] px-2"
      role="search"
      aria-label="Find on page"
      data-browser-find-bar
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder="Find on page"
        aria-label="Find on page"
        aria-invalid={noMatches || undefined}
        className={cn(
          "h-7 w-60 rounded-md border bg-charcoal-card px-2 text-sm text-cream outline-none",
          "placeholder:text-cream-muted focus-visible:ring-2 focus-visible:ring-white/15",
          noMatches ? "border-red-400/60" : "border-charcoal-border",
        )}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          } else if (event.key === "Enter" && query) {
            event.preventDefault();
            find(event.shiftKey ? "previous" : "next");
          }
        }}
      />
      <span className="w-20 text-center text-xs tabular-nums text-cream-muted" aria-live="polite">
        {query && result ? (result.total ? `${result.current} of ${result.total}` : "No matches") : ""}
      </span>
      <button
        type="button"
        className={iconButton}
        aria-label="Previous match"
        disabled={!result?.total}
        onClick={() => find("previous")}
      >
        <ChevronUp {...browserToolbarStyles.icon} />
      </button>
      <button
        type="button"
        className={iconButton}
        aria-label="Next match"
        disabled={!result?.total}
        onClick={() => find("next")}
      >
        <ChevronDown {...browserToolbarStyles.icon} />
      </button>
      <button type="button" className={iconButton} aria-label="Close find" onClick={close}>
        <X {...browserToolbarStyles.icon} />
      </button>
    </div>
  );
}
