import { blankBrowserUrl } from "@/features/workspace/model";
import { isNewTabOverrideUrl } from "@/features/workspace/browserHome";
import { cn, Input, SuggestionList } from "@/shared/ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { OmniboxRow } from "./omnibox/OmniboxRow";
import type { OmniboxInput, OmniboxMatch, OmniboxProvider } from "./omnibox/types";
import { inlineCompletion } from "./omnibox/urlText";
import { useOmniboxAutocomplete } from "./omnibox/useOmniboxAutocomplete";
import { warmOmniboxCaches } from "./omnibox/liveDeps";
import { useBrowserOverlay } from "./useBrowserOverlay";

export type OmniboxContext = Omit<OmniboxInput, "text" | "currentUrl">;

export function BrowserOmniboxView(props: {
  currentUrl: string;
  focusRequest?: number;
  context: OmniboxContext;
  providers: readonly OmniboxProvider[];
  suspensionReason: string;
  setOverlay: (reason: string, active: boolean) => Promise<void>;
  /** `typed` is true when the person chose a page by its address rather than a search. */
  onNavigate: (value: string, options: { typed: boolean }) => void;
  onSwitchView: (tabId: string) => void;
  /** Opens a place inside Misty, such as a note, by its app route. */
  onOpenInApp: (route: string) => void;
  onRemove?: (match: OmniboxMatch) => Promise<void>;
  /** A control at the field's end while it rests, such as the bookmark star. */
  trailing?: ReactNode;
  /** Sits inside the field's left edge, as the site-info button does in the sidebar. */
  leading?: ReactNode;
  /** At rest show just the site for secure pages, as the sidebar's compact field does. */
  hostOnly?: boolean;
  /** Focusing hands over to the shared search panel, opened where the field sits. */
  panel?: boolean;
  onOpenPanel?: (field: DOMRect) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const trailingRef = useRef<HTMLDivElement | null>(null);
  const [trailingWidth, setTrailingWidth] = useState(0);
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
  // Ready the address bar's caches before it is used, and again on focus in case
  // bookmarks or Spaces changed meanwhile.
  useEffect(() => warmOmniboxCaches(), [focused]);
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
  const shown = focused
    ? draft + (completion ?? "")
    : props.hostOnly
      ? hostAddress(props.currentUrl)
      : toolbarAddress(props.currentUrl);

  useLayoutEffect(() => {
    if (completion && inputRef.current === document.activeElement)
      inputRef.current?.setSelectionRange(draft.length, draft.length + completion.length);
  }, [completion, draft]);

  // The page can move on while the field still holds focus (the page is a separate native view,
  // so clicking a link there never blurs this field). An unedited address follows the page;
  // only text the person typed is kept.
  const previousUrl = useRef(props.currentUrl);
  useEffect(() => {
    const previous = previousUrl.current;
    previousUrl.current = props.currentUrl;
    setDraft((current) =>
      !focused || current === displayBrowserAddress(previous)
        ? displayBrowserAddress(props.currentUrl)
        : current,
    );
  }, [focused, props.currentUrl]);

  useEffect(() => {
    if (!props.focusRequest) return;
    if (openPanel()) return;
    setFocused(true);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
    // Only a new request opens the field; the panel opener is read fresh each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focusRequest]);

  /** The sidebar's field is only a doorway: the shared search panel opens over it. */
  const openPanel = () => {
    if (!props.panel || !props.onOpenPanel || !formRef.current) return false;
    props.onOpenPanel(formRef.current.getBoundingClientRect());
    inputRef.current?.blur();
    return true;
  };

  useLayoutEffect(() => {
    const element = trailingRef.current;
    if (!element) {
      setTrailingWidth(0);
      return;
    }
    const measure = () => setTrailingWidth(element.offsetWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.trailing, focused]);

  const close = () => {
    setFocused(false);
    overlay.onOpenChange(false);
    inputRef.current?.blur();
  };
  const choose = (match: OmniboxMatch | undefined) => {
    if (match?.target.type === "switch-tab") props.onSwitchView(match.target.tabId);
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
    <div
      className={props.panel ? "relative min-w-0 flex-1" : "contents"}
      style={props.panel ? { height: 36 } : undefined}
    >
      <form
        ref={formRef}
        className="relative z-50 min-w-0 flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          choose(selected);
        }}
      >
        <Input
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
            if (openPanel()) return;
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
          variant="address"
          style={
            props.trailing && !focused && trailingWidth
              ? { paddingRight: trailingWidth + 8 }
              : undefined
          }
          className={cn(
            "h-9 rounded-lg px-3 text-sm",
            props.trailing && !focused ? "pr-10 text-left" : "text-left",
            props.leading && !focused && "pl-9",
          )}
        />
        {props.leading && !focused ? (
          <div className="absolute inset-y-0 left-1 flex items-center">{props.leading}</div>
        ) : null}
        {props.trailing && !focused ? (
          <div ref={trailingRef} className="absolute inset-y-0 right-1 flex items-center">
            {props.trailing}
          </div>
        ) : null}
        {focused && overlay.open && matches.length ? (
          <SuggestionList
            id="browser-omnibox-suggestions"
            className="absolute left-0 right-0 top-[calc(100%+7px)]"
          >
            {matches.map((match) => (
              <OmniboxRow
                key={match.id}
                match={match}
                selected={match === selected}
                onChoose={() => choose(match)}
                onPoint={() => setSelectedId(match.id)}
                onSwitchView={(tabId) => {
                  props.onSwitchView(tabId);
                  close();
                }}
                onRemove={match.removable && props.onRemove ? () => remove(match) : undefined}
              />
            ))}
          </SuggestionList>
        ) : null}
      </form>
    </div>
  );
}

function displayBrowserAddress(value: string): string {
  return value === blankBrowserUrl || isNewTabOverrideUrl(value) ? "" : value;
}

/** The full address at rest, protocol included, so where a page lives is never hidden. */
function toolbarAddress(value: string): string {
  return value === blankBrowserUrl || isNewTabOverrideUrl(value) ? "Search or enter URL" : value;
}

/** A secure page's site without protocol, www or path; anything else keeps its full address. */
function hostAddress(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.hostname.replace(/^www\./, "");
  } catch {
    /* Not a URL: show it as it is. */
  }
  return toolbarAddress(value);
}
