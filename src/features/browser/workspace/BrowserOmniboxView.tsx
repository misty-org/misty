import { blankBrowserUrl } from "@/features/workspace/model";
import { Button, cn, menuListClass, popupSurfaceClass } from "@/shared/ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { OmniboxRow } from "./omnibox/OmniboxRow";
import type { OmniboxInput, OmniboxMatch, OmniboxProvider } from "./omnibox/types";
import { inlineCompletion } from "./omnibox/urlText";
import { useOmniboxAutocomplete } from "./omnibox/useOmniboxAutocomplete";
import { useBrowserOverlay } from "./useBrowserOverlay";

export type OmniboxContext = Omit<OmniboxInput, "text" | "currentUrl">;

export function BrowserOmniboxView(props: {
  currentUrl: string;
  compact?: boolean;
  pageTitle?: string;
  focusRequest?: number;
  context: OmniboxContext;
  providers: readonly OmniboxProvider[];
  lightChrome: boolean;
  suspensionReason: string;
  setOverlay: (reason: string, active: boolean) => Promise<void>;
  /** `typed` is true when the person chose a page by its address rather than a search. */
  onNavigate: (value: string, options: { typed: boolean }) => void;
  onSwitchTab: (tabId: string) => void;
  /** Opens a place inside Misty, such as a note, by its app route. */
  onOpenInApp: (route: string) => void;
  onRemove?: (match: OmniboxMatch) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() => displayBrowserAddress(props.currentUrl));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Deleting must not bring the completion straight back.
  const [inlineSuppressed, setInlineSuppressed] = useState(false);
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set());
  const overlay = useBrowserOverlay(props.suspensionReason, props.setOverlay);

  // Unedited, the address bar shows the page's own address: suggest before typing.
  const text = draft === displayBrowserAddress(props.currentUrl) ? "" : draft;
  const input = useMemo<OmniboxInput | null>(
    () => (focused ? { ...props.context, text, currentUrl: props.currentUrl } : null),
    [focused, props.context, props.currentUrl, text],
  );
  const results = useOmniboxAutocomplete(input, props.providers);
  const matches = useMemo(
    () => results.filter((match) => !removedIds.has(match.id)),
    [removedIds, results],
  );
  const selectedIndex = Math.max(
    0,
    matches.findIndex((match) => match.id === selectedId),
  );
  // Before typing or arrowing, only a default-eligible row may be picked by Enter.
  const selected =
    selectedId === null && !text && !matches[0]?.allowedToBeDefault
      ? undefined
      : matches[selectedIndex];
  // Recomputed from the draft: a slower provider's row may predate the last keystroke.
  const completion =
    selectedIndex === 0 && selected?.inlineCompletion !== undefined && !inlineSuppressed
      ? inlineCompletion(draft, selected.target.url)
      : undefined;
  const shown = focused ? draft + (completion ?? "") : toolbarAddress(props.currentUrl);

  useLayoutEffect(() => {
    if (completion && inputRef.current === document.activeElement)
      inputRef.current?.setSelectionRange(draft.length, draft.length + completion.length);
  }, [completion, draft]);

  useEffect(() => {
    if (!focused) setDraft(displayBrowserAddress(props.currentUrl));
  }, [focused, props.currentUrl]);

  useEffect(() => {
    if (!props.focusRequest) return;
    setFocused(true);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [props.focusRequest]);

  const close = () => {
    setFocused(false);
    overlay.onOpenChange(false);
    inputRef.current?.blur();
  };
  const choose = (match: OmniboxMatch | undefined) => {
    if (match?.target.type === "switch-tab") props.onSwitchTab(match.target.tabId);
    else if (match?.target.type === "open-in-app") props.onOpenInApp(match.target.url);
    else if (match) {
      const typed = match.kind !== "search" && match.kind !== "suggestion";
      props.onNavigate(match.target.url, { typed });
    } else if (draft.trim()) props.onNavigate(draft, { typed: false });
    close();
  };
  const remove = (match: OmniboxMatch) => {
    setRemovedIds((ids) => new Set(ids).add(match.id));
    void props.onRemove?.(match).catch(() =>
      setRemovedIds((ids) => {
        const next = new Set(ids);
        next.delete(match.id);
        return next;
      }),
    );
  };
  const moveSelection = (delta: number) => {
    if (!matches.length) return;
    setSelectedId(matches[(selectedIndex + delta + matches.length) % matches.length].id);
  };

  return (
    <form
      className="relative z-50 min-w-0 flex-1"
      onSubmit={(event) => {
        event.preventDefault();
        choose(selected);
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
        value={shown}
        onChange={(event) => {
          const inputType = (event.nativeEvent as InputEvent).inputType ?? "";
          setInlineSuppressed(inputType.startsWith("delete"));
          setDraft(event.target.value);
          setSelectedId(null);
          setRemovedIds(new Set());
        }}
        onFocus={(event) => {
          const element = event.currentTarget;
          setFocused(true);
          setDraft(displayBrowserAddress(props.currentUrl));
          setSelectedId(null);
          overlay.onOpenChange(true);
          window.requestAnimationFrame(() => element.select());
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
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            moveSelection(event.key === "ArrowDown" ? 1 : -1);
          } else if ((event.key === "ArrowRight" || event.key === "End") && completion) {
            // Accept the completion as if typed, and keep editing after it.
            event.preventDefault();
            setDraft(draft + completion);
          } else if (
            // Shift+Delete, or Shift+Backspace on a Mac keyboard, once a row is highlighted.
            (event.key === "Delete" || event.key === "Backspace") &&
            event.shiftKey &&
            selectedId !== null &&
            selected?.removable
          ) {
            event.preventDefault();
            remove(selected);
          } else if (event.key === "Escape") {
            event.preventDefault();
            if (completion) setInlineSuppressed(true);
            else close();
          }
        }}
        aria-label="Search or enter address"
        aria-autocomplete="both"
        aria-controls="browser-omnibox-suggestions"
        aria-expanded={focused && overlay.open && matches.length > 0}
        aria-activedescendant={focused && matches.length ? selected?.id : undefined}
        autoComplete="off"
        spellCheck={false}
        className={cn(
          "h-[30px] w-full min-w-0 rounded-md border bg-transparent px-2 text-center text-xs outline-none transition-colors",
          props.lightChrome
            ? "border-black/[0.06] text-[#252525] hover:bg-black/[0.025] focus:border-black/[0.11] focus:bg-[#ededed] focus:text-left"
            : "border-white/[0.07] text-[#e7e7e7] hover:bg-white/[0.025] focus:border-white/[0.12] focus:bg-[#222] focus:text-left",
        )}
      />
      {focused && overlay.open && matches.length ? (
        <div
          id="browser-omnibox-suggestions"
          role="listbox"
          className={cn(
            "absolute left-0 right-0 top-[calc(100%+7px)] overflow-hidden",
            popupSurfaceClass,
            menuListClass,
          )}
        >
          {matches.map((match, index) => (
            <OmniboxRow
              key={match.id}
              match={match}
              selected={match === selected}
              onChoose={() => choose(match)}
              onPoint={() => setSelectedId(match.id)}
              onSwitchTab={(tabId) => {
                props.onSwitchTab(tabId);
                close();
              }}
              onRemove={match.removable && props.onRemove ? () => remove(match) : undefined}
            />
          ))}
        </div>
      ) : null}
    </form>
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
