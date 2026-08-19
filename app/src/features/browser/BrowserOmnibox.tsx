import { blankBrowserUrl } from "@/features/workspace";
import { cn } from "@/shared/ui";
import { ArrowUpRight, Globe2, History, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { browserRuntimeId } from "./browserRuntime";
import { buildBrowserSuggestions, type BrowserSuggestion } from "./browserSuggestions";
import { useBrowserOverlayControl } from "./useBrowserOverlayControl";
import type { WorkspaceTab } from "@/features/workspace";

export function BrowserOmnibox(props: {
  currentUrl: string;
  historyEntries: string[];
  lightChrome: boolean;
  tab: WorkspaceTab;
  onNavigate: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() => displayBrowserAddress(props.currentUrl));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const overlay = useBrowserOverlayControl(`browser-omnibox:${browserRuntimeId(props.tab)}`);
  const suggestions = useMemo(
    () => buildBrowserSuggestions(draft, props.historyEntries),
    [draft, props.historyEntries],
  );

  useEffect(() => {
    if (!focused) setDraft(displayBrowserAddress(props.currentUrl));
  }, [focused, props.currentUrl]);

  const choose = (suggestion?: BrowserSuggestion) => {
    props.onNavigate(suggestion?.destination ?? draft);
    setFocused(false);
    overlay.onOpenChange(false);
    inputRef.current?.blur();
  };

  return (
    <form
      className="absolute left-1/2 top-1/2 z-50 w-[min(54vw,720px)] -translate-x-1/2 -translate-y-1/2"
      onSubmit={(event) => {
        event.preventDefault();
        choose(suggestions[selectedIndex]);
      }}
    >
      <input
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
          "h-9 w-full rounded-lg border bg-transparent px-3 text-center text-[16px] outline-none transition-colors",
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
            "absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden rounded-xl border p-1.5 text-left shadow-2xl",
            props.lightChrome
              ? "border-black/10 bg-[#f5f5f5] text-[#252525]"
              : "border-white/10 bg-[#282828] text-[#eeeeee]",
          )}
        >
          {suggestions.map((suggestion, index) => (
            <SuggestionRow
              key={suggestion.id}
              suggestion={suggestion}
              selected={index === selectedIndex}
              lightChrome={props.lightChrome}
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
  lightChrome: boolean;
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
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left",
        props.selected && (props.lightChrome ? "bg-black/[0.07]" : "bg-white/[0.09]"),
      )}
      onPointerEnter={props.onPoint}
      onPointerDown={(event) => event.preventDefault()}
      onClick={props.onChoose}
    >
      {props.suggestion.faviconUrl ? (
        <img src={props.suggestion.faviconUrl} alt="" className="size-5 rounded-sm" />
      ) : (
        <Icon size={19} strokeWidth={1.7} className="shrink-0 opacity-70" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{props.suggestion.title}</span>
      <span className="max-w-[48%] truncate text-xs opacity-55">{props.suggestion.detail}</span>
      {props.suggestion.kind === "site" ? <ArrowUpRight size={15} className="opacity-55" /> : null}
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
