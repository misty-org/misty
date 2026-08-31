import { Search } from "lucide-react";
import { forwardRef } from "react";

export interface TerminalSearchResult {
  resultIndex: number;
  resultCount: number;
}

interface TerminalSearchFieldProps {
  value: string;
  result: TerminalSearchResult;
  shortcutLabel: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onNavigate: (direction: "next" | "previous") => void;
  onDismiss: () => void;
}

/** Persistent, compact find control for the terminal's complete scrollback. */
export const TerminalSearchField = forwardRef<HTMLInputElement, TerminalSearchFieldProps>(
  function TerminalSearchField(props, ref) {
    const resultLabel = formatResultLabel(props.value, props.result);

    return (
      <div
        role="search"
        className="flex h-6 min-w-0 w-64 max-w-[55%] items-center gap-1.5 rounded border border-charcoal-border bg-charcoal-card px-2 text-[11px] text-cream-muted transition-colors focus-within:border-charcoal-active focus-within:text-cream"
      >
        <Search size={12} className="shrink-0" aria-hidden="true" />
        <input
          ref={ref}
          type="text"
          role="searchbox"
          aria-label="Find in terminal"
          aria-keyshortcuts="Meta+F Control+F"
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={props.disabled}
          value={props.value}
          placeholder="Find in terminal"
          className="h-full min-w-0 flex-1 bg-transparent font-sans text-[11px] text-cream placeholder:text-cream-muted disabled:text-cream-muted"
          onChange={(event) => props.onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              props.onDismiss();
              return;
            }
            if (event.key === "Enter" && props.value) {
              event.preventDefault();
              props.onNavigate(event.shiftKey ? "previous" : "next");
            }
          }}
        />
        {props.value ? (
          <output
            aria-live="polite"
            aria-atomic="true"
            className="shrink-0 tabular-nums text-[10px] text-cream-muted"
          >
            {resultLabel}
          </output>
        ) : (
          <span aria-hidden="true" className="shrink-0 text-[10px] text-cream-muted">
            {props.shortcutLabel}
          </span>
        )}
      </div>
    );
  },
);

function formatResultLabel(query: string, result: TerminalSearchResult): string {
  if (!query || result.resultCount <= 0) return "No matches";
  if (result.resultIndex < 0) return `${result.resultCount} matches`;
  return `${result.resultIndex + 1}/${result.resultCount}`;
}
