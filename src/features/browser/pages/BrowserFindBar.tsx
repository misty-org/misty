import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Checkbox, cn, IconButton, Input, toolbarIconProps } from "@/shared/ui";
import {
  browserPageTools,
  type BrowserFindOptions,
  type BrowserFindResult,
} from "../library/native";

const optionLabels: [keyof BrowserFindOptions, string][] = [
  ["highlightAll", "Highlight All"],
  ["matchCase", "Match Case"],
  ["matchDiacritics", "Match Diacritics"],
  ["wholeWords", "Whole Words"],
];

/**
 * Find in page. A bar docked under the page, like Firefox and Zen: it takes its own row
 * in the layout, so the page shrinks to make room and is never covered or touched.
 */
export function BrowserFindBar(props: {
  runtimeId: string;
  /** Bumped each time find is requested; opens and focuses the bar, or closes it if open. */
  request: number;
  /** The page changed; stale highlights and counts no longer apply. */
  pageKey: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<BrowserFindOptions>({
    highlightAll: true,
    matchCase: false,
    matchDiacritics: false,
    wholeWords: false,
  });
  const [result, setResult] = useState<BrowserFindResult | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const generation = useRef(0);

  // Each request toggles: the shortcut opens the bar, and pressing it again closes it.
  useEffect(() => {
    if (!props.request) return;
    if (open) {
      close();
      return;
    }
    setOpen(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    // Only a new request toggles; the state it reads is the current render's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.request]);

  useEffect(() => setResult(null), [props.pageKey]);

  const find = (direction: "next" | "previous" | "clear", text = query) => {
    const current = ++generation.current;
    void browserPageTools
      .find(props.runtimeId, text, direction, options)
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
    // Searching again when the text or an option changes; arrows step through matches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, options, open, props.pageKey]);

  const close = () => {
    setOpen(false);
    setQuery("");
    find("clear", "");
  };

  if (!open) return null;
  const noMatches = Boolean(query) && result?.total === 0;
  return (
    <div
      className="flex h-11 shrink-0 items-center gap-2 border-t border-charcoal-border bg-charcoal-card px-2 text-sm text-cream"
      role="search"
      aria-label="Find on page"
      data-browser-find-bar
    >
      <IconButton label="Close find" tooltip={false} onClick={close}>
        <X {...toolbarIconProps} />
      </IconButton>
      <Input
        ref={inputRef}
        variant="toolbar"
        type="text"
        value={query}
        placeholder="Find on page"
        aria-label="Find on page"
        aria-invalid={noMatches || undefined}
        className={cn("h-7 w-60 text-sm", noMatches && "border-cream-bright/60")}
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
      <IconButton
        label="Previous match"
        tooltip={false}
        disabled={!result?.total}
        onClick={() => find("previous")}
      >
        <ChevronUp {...toolbarIconProps} />
      </IconButton>
      <IconButton
        label="Next match"
        tooltip={false}
        disabled={!result?.total}
        onClick={() => find("next")}
      >
        <ChevronDown {...toolbarIconProps} />
      </IconButton>
      {optionLabels.map(([key, label]) => (
        <label key={key} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
          <Checkbox
            checked={options[key]}
            onCheckedChange={(checked) => setOptions({ ...options, [key]: checked === true })}
          />
          {label}
        </label>
      ))}
      <span
        className="ml-auto truncate pr-1 text-xs tabular-nums text-cream-muted"
        aria-live="polite"
      >
        {query && result
          ? result.total
            ? `${result.current} of ${result.total}`
            : "Phrase not found"
          : ""}
      </span>
    </div>
  );
}
