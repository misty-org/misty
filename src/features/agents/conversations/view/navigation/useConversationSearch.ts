// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useShortcutHandler } from "@/features/shortcuts";
import type { GlobalAiMessage } from "../../state/conversationTypes";
import {
  clearSearchHighlights,
  findTimelineMatches,
  firstMatchIn,
  FOLD_OPEN_MS,
  paintSearchHighlights,
  revealFoldsAround,
  scrollMatchIntoView,
  searchHighlightSupported,
} from "./timelineSearch";
import { takeChatFind, usePendingChatFind } from "./chatFind";

function messageElement(root: HTMLElement, id: string): HTMLElement | null {
  for (const element of root.querySelectorAll<HTMLElement>("[data-message-id]"))
    if (element.dataset.messageId === id) return element;
  return null;
}

/** Whether the chat is on screen: a chat kept mounted behind another view leaves ⌘F alone. */
function visible(element: HTMLElement | null): element is HTMLElement {
  return Boolean(
    element &&
    element.isConnected &&
    getComputedStyle(element).visibility !== "hidden" &&
    element.getClientRects().length,
  );
}

/**
 * Search inside a chat. Matching runs on the messages (all of them); highlighting runs on the
 * DOM with the Custom Highlight API, repainted as answers stream in. ⌘F opens and closes it.
 */
export function useConversationSearch(
  scrollRef: RefObject<HTMLElement | null>,
  messages: GlobalAiMessage[],
  conversationId?: string,
) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [revision, setRevision] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useShortcutHandler(
    "chat.search",
    () => {
      if (openRef.current) {
        setOpen(false);
        return;
      }
      setOpen(true);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    },
    () => visible(scrollRef.current),
  );
  // Search opened this chat at a match: show the same words here once its messages are in.
  const pendingFind = usePendingChatFind(conversationId);
  const hasMessages = messages.length > 0;
  useEffect(() => {
    if (!conversationId || pendingFind === undefined || !hasMessages) return;
    takeChatFind(conversationId);
    if (!pendingFind) return;
    setCaseSensitive(false);
    setWholeWord(false);
    setUseRegex(false);
    setQuery(pendingFind);
    setCursor(0);
    setOpen(true);
  }, [conversationId, pendingFind, hasMessages]);
  const options = useMemo(
    () => ({ caseSensitive, wholeWord, regexp: useRegex }),
    [caseSensitive, wholeWord, useRegex],
  );
  const matches = useMemo(
    () => (open ? findTimelineMatches(messages, query, options) : []),
    [open, messages, query, options],
  );
  // Streaming can change the count; the cursor is clamped, never reset, so the place is kept.
  const safeCursor = matches.length ? Math.min(cursor, matches.length - 1) : 0;
  const currentMessageId = matches.length ? matches[safeCursor].messageId : null;
  // Which of its message's matches the current one is, to find its Range when one message has
  // several, and how many the message has, to check the DOM drew the same ones.
  const { occurrence, total } = useMemo(() => {
    if (currentMessageId === null) return { occurrence: 0, total: 0 };
    const first = matches.findIndex((match) => match.messageId === currentMessageId);
    let end = first;
    while (end < matches.length && matches[end].messageId === currentMessageId) end++;
    return { occurrence: safeCursor - first, total: end - first };
  }, [currentMessageId, matches, safeCursor]);
  const reset = () => {
    setCursor(0);
    setRevision((value) => value + 1);
  };
  const lastScrolled = useRef<string | null>(null);
  const revealedFor = useRef<string | null>(null);
  useEffect(() => {
    const root = scrollRef.current;
    if (!open || !root) {
      lastScrolled.current = null;
      return;
    }
    // Changes on every query and every next or previous, so going back to a match scrolls again.
    const key = [revision, query, safeCursor, caseSensitive, wholeWord, useRegex].join("\u0000");
    let frame = 0;
    let unfolding = 0;
    let unfoldedAt = 0;
    const paint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const active = searchHighlightSupported()
          ? paintSearchHighlights(root, query, currentMessageId, options, occurrence, total)
          : null;
        if (lastScrolled.current === key || currentMessageId === null) return;
        // While a fold opens, a repaint (an answer streaming) waits for it rather than scrolling early.
        if (Date.now() < unfoldedAt) return;
        // A match inside a folded step opens the fold first, and scrolls once it has opened.
        const target = active ?? firstMatchIn(root, query, currentMessageId, options);
        if (revealedFor.current !== key && revealFoldsAround(target)) {
          revealedFor.current = key;
          unfoldedAt = Date.now() + FOLD_OPEN_MS;
          clearTimeout(unfolding);
          unfolding = window.setTimeout(paint, FOLD_OPEN_MS);
          return;
        }
        lastScrolled.current = key;
        // Repaints while an answer streams must not pull the view back to the match.
        if (target) scrollMatchIntoView(root, target);
        else messageElement(root, currentMessageId)?.scrollIntoView({ block: "nearest" });
      });
    };
    paint();
    const observer = new MutationObserver(paint);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(unfolding);
      observer.disconnect();
      clearSearchHighlights();
    };
  }, [
    open,
    query,
    currentMessageId,
    occurrence,
    total,
    safeCursor,
    revision,
    caseSensitive,
    wholeWord,
    useRegex,
    options,
    scrollRef,
  ]);
  // Escape closes it wherever focus went, unless something open on top took the key first.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (visible(scrollRef.current)) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, scrollRef]);
  return {
    open,
    close: () => setOpen(false),
    inputRef,
    query,
    setQuery: (value: string) => {
      setQuery(value);
      reset();
    },
    caseSensitive,
    setCaseSensitive: (value: boolean) => {
      setCaseSensitive(value);
      reset();
    },
    wholeWord,
    setWholeWord: (value: boolean) => {
      setWholeWord(value);
      reset();
    },
    useRegex,
    setUseRegex: (value: boolean) => {
      setUseRegex(value);
      reset();
    },
    current: matches.length ? safeCursor + 1 : 0,
    total: matches.length,
    next: () => {
      setRevision((value) => value + 1);
      if (matches.length) setCursor((safeCursor + 1) % matches.length);
    },
    previous: () => {
      setRevision((value) => value + 1);
      if (matches.length) setCursor((safeCursor - 1 + matches.length) % matches.length);
    },
  };
}
