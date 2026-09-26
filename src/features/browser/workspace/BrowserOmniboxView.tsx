import { blankBrowserUrl } from "@/features/workspace/model";
import { Button, cn, menuItemClass, menuListClass, popupSurfaceClass } from "@/shared/ui";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { ArrowUpRight, Globe2, History, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildBrowserSuggestions, type BrowserSuggestion } from "./browserSuggestions";
import { useBrowserOverlay } from "./useBrowserOverlay";

export function BrowserOmniboxView(props: {
  currentUrl: string;
  compact?: boolean;
  pageTitle?: string;
  focusRequest?: number;
  historyEntries: string[];
  lightChrome: boolean;
  suspensionReason: string;
  setOverlay: (reason: string, active: boolean) => Promise<void>;
  onNavigate: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() => displayBrowserAddress(props.currentUrl));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const overlay = useBrowserOverlay(props.suspensionReason, props.setOverlay);
  const suggestions = useMemo(
    () => buildBrowserSuggestions(draft, props.historyEntries),
    [draft, props.historyEntries],
  );

  useEffect(() => {
    if (!focused) setDraft(displayBrowserAddress(props.currentUrl));
  }, [focused, props.currentUrl]);

  useEffect(() => {
    if (!props.focusRequest) return;
    setFocused(true);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [props.focusRequest]);

  const choose = (suggestion?: BrowserSuggestion) => {
    props.onNavigate(suggestion?.destination ?? draft);
    setFocused(false);
    overlay.onOpenChange(false);
    inputRef.current?.blur();
  };

  return (
    <form
      className="relative z-50 min-w-0 flex-1"
      onSubmit={(event) => {
        event.preventDefault();
        choose(suggestions[selectedIndex]);
      }}
    >
      {props.compact && !focused && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-center overflow-hidden text-xs text-cream-muted"
          aria-label="Show current address"
          title="Show current address"
          onClick={() => {
            setFocused(true);
            window.requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          <span className="min-w-0 truncate">{props.pageTitle || "Website"}</span>
        </Button>
      )}
      <input
        hidden={props.compact && !focused}
        ref={inputRef}
        value={focused ? draft : toolbarAddress(props.currentUrl)}
        onChange={(event) => {
          setDraft(event.target.value);
          setSelectedIndex(0);
        }}
        onFocus={(event) => {
          const input = event.currentTarget;
          setFocused(true);
          setDraft(displayBrowserAddress(props.currentUrl));
          setSelectedIndex(0);
          overlay.onOpenChange(true);
          window.requestAnimationFrame(() => input.select());
        }}
        onPointerDown={(event) => {
          if (document.activeElement === event.currentTarget) return;
          event.preventDefault();
          event.currentTarget.focus();
        }}
        onBlur={() => {
          setFocused(false);
          overlay.onOpenChange(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && suggestions.length) {
            event.preventDefault();
            setSelectedIndex((index) => (index + 1) % suggestions.length);
          } else if (event.key === "ArrowUp" && suggestions.length) {
            event.preventDefault();
            setSelectedIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setFocused(false);
            overlay.onOpenChange(false);
            event.currentTarget.blur();
          }
        }}
        aria-label="Search or enter address"
        aria-autocomplete="list"
        aria-controls="browser-omnibox-suggestions"
        aria-expanded={focused && overlay.open && suggestions.length > 0}
        aria-activedescendant={suggestions[selectedIndex]?.id}
        autoComplete="off"
        spellCheck={false}
        className={cn(
          "w-full min-w-0 rounded-md border bg-transparent px-2 text-center outline-none transition-colors",
          isNativeMobileBuild ? "h-11 text-base" : "h-[30px] text-xs",
          props.lightChrome
            ? "border-black/[0.06] text-[#252525] hover:bg-black/[0.025] focus:border-black/[0.11] focus:bg-[#ededed] focus:text-left"
            : "border-white/[0.07] text-[#e7e7e7] hover:bg-white/[0.025] focus:border-white/[0.12] focus:bg-[#222] focus:text-left",
        )}
      />
      {focused && overlay.open && suggestions.length ? (
        <div
          id="browser-omnibox-suggestions"
          role="listbox"
          className={cn(
            "absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden",
            popupSurfaceClass,
            menuListClass,
          )}
        >
          {suggestions.map((suggestion, index) => (
            <SuggestionRow
              key={suggestion.id}
              suggestion={suggestion}
              selected={index === selectedIndex}
              onChoose={() => choose(suggestion)}
              onPoint={() => setSelectedIndex(index)}
            />
          ))}
        </div>
      ) : null}
    </form>
  );
}

function SuggestionRow(props: {
  suggestion: BrowserSuggestion;
  selected: boolean;
  onChoose: () => void;
  onPoint: () => void;
}) {
  const Icon =
    props.suggestion.kind === "search"
      ? Search
      : props.suggestion.kind === "history"
        ? History
        : Globe2;
  return (
    <button
      id={props.suggestion.id}
      type="button"
      role="option"
      aria-selected={props.selected}
      className={cn(menuItemClass, "gap-3", props.selected && "bg-charcoal-hover")}
      onPointerEnter={props.onPoint}
      onPointerDown={(event) => event.preventDefault()}
      onClick={props.onChoose}
    >
      <Icon strokeWidth={1.7} className="opacity-70" />
      <span className="min-w-0 flex-1 truncate font-medium">{props.suggestion.title}</span>
      <span className="max-w-[48%] truncate text-xs opacity-55">{props.suggestion.detail}</span>
      {props.suggestion.kind === "site" ? <ArrowUpRight className="opacity-55" /> : null}
    </button>
  );
}

function displayBrowserAddress(value: string): string {
  return value === blankBrowserUrl ? "" : value;
}

function toolbarAddress(value: string): string {
  if (value === blankBrowserUrl) return "Search or enter URL";
  try {
    return new URL(value).hostname.replace(/^www\./, "") || value;
  } catch {
    return value;
  }
}
