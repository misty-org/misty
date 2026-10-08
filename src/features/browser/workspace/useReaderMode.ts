import { useEffect, useRef, useState } from "react";
import { useShortcutHandler } from "@/features/shortcuts";
import type { WorkspaceView } from "@/features/workspace";
import { browserPageTools } from "../library/native";
import { browserRuntimeId, useBrowserRuntimeStore } from "./browserRuntime";
import { parseReaderArticle, type ReaderArticle } from "./readerArticle";

/**
 * Reader mode for one tab. The article is read from the live page, shown over
 * it, and dropped when the page navigates; the page itself never reloads.
 */
export function useReaderMode(input: {
  tab: WorkspaceView;
  url: string;
  /** A native web page is showing. */
  available: boolean;
  focused: () => boolean;
}) {
  const [article, setArticle] = useState<ReaderArticle | null>(null);
  const currentUrl = useRef(input.url);
  currentUrl.current = input.url;
  useEffect(() => setArticle(null), [input.url]);
  const toggle = () => {
    if (article) {
      setArticle(null);
      return;
    }
    const url = input.url;
    const tabId = input.tab.id;
    void browserPageTools
      .readerArticle(browserRuntimeId(input.tab))
      .then((value) => {
        if (currentUrl.current !== url) return;
        const parsed = parseReaderArticle(value);
        if (parsed) setArticle(parsed);
        else
          useBrowserRuntimeStore.getState().setNotice(tabId, "This page has no article to read.");
      })
      .catch((error: unknown) =>
        useBrowserRuntimeStore
          .getState()
          .setError(tabId, error instanceof Error ? error.message : String(error)),
      );
  };
  const enabled = input.available || article !== null;
  useShortcutHandler(
    "browser.reader_mode",
    () => {
      if (!enabled) return false;
      toggle();
      return true;
    },
    input.focused,
    100,
  );
  return { article, toggle: enabled ? toggle : undefined, close: () => setArticle(null) };
}
