// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { useCallback, useEffect, useRef } from "react";
import { getPromptHistory, INVISIBLE_CHARS_RE, subscribePromptHistory } from "./promptHistory";

interface HistoryKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  preventDefault: () => void;
}

/**
 * Shell-style recall in the message box: Up on an empty box walks the sent messages newest to
 * oldest, Down walks back, and past the newest restores what was there. Any other key ends the
 * walk. Returns whether the key was used.
 */
export function usePromptHistoryNav({
  getText,
  setText,
}: {
  getText: () => string;
  setText: (text: string) => void;
}): { handleKeyDown: (event: HistoryKeyEvent) => boolean; resetNavigation: () => void } {
  const indexRef = useRef(-1);
  const draftRef = useRef("");
  const resetNavigation = useCallback(() => {
    indexRef.current = -1;
    draftRef.current = "";
  }, []);
  // Sending records a message and clears the box: the walk starts over.
  useEffect(() => subscribePromptHistory(resetNavigation), [resetNavigation]);
  const handleKeyDown = useCallback(
    (event: HistoryKeyEvent): boolean => {
      const key = event.key;
      const navigating = indexRef.current !== -1;
      if (navigating && key !== "ArrowUp" && key !== "ArrowDown") {
        resetNavigation();
        return false;
      }
      if (key !== "ArrowUp" && key !== "ArrowDown") return false;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
      const items = getPromptHistory();
      if (!items.length) return false;
      const current = getText();
      // A walk only starts from an empty box, and only with Up.
      if (!navigating && current.replace(INVISIBLE_CHARS_RE, "").trim()) return false;
      if (!navigating && key === "ArrowDown") return false;
      event.preventDefault();
      if (!navigating) draftRef.current = current;
      if (key === "ArrowUp") {
        const next = navigating ? Math.max(0, indexRef.current - 1) : items.length - 1;
        indexRef.current = next;
        setText(items[next] ?? draftRef.current);
        return true;
      }
      if (indexRef.current < items.length - 1) {
        indexRef.current += 1;
        setText(items[indexRef.current] ?? draftRef.current);
        return true;
      }
      setText(draftRef.current);
      resetNavigation();
      return true;
    },
    [getText, setText, resetNavigation],
  );
  return { handleKeyDown, resetNavigation };
}
