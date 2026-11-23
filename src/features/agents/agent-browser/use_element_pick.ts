import { useEffect, useRef, useState } from "react";
import { useMistyStore } from "../conversations/state/use_misty_store";
import { errorText } from "../context-panel/project_api";
import { withElementBlock } from "./picked_element";
import { isLocalPage, pickApi, type PagePick } from "./pick_api";

export function useElementPick(page: string, url: string | undefined, loading: boolean) {
  const local = Boolean(page) && isLocalPage(url);
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState<PagePick | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const shownPage = useRef(page);
  shownPage.current = page;

  useEffect(() => {
    if (local && !loading) void pickApi.watch(page).catch(() => undefined);
  }, [page, local, loading, url]);

  useEffect(() => {
    setPick(null);
    setSent(false);
    setPicking(false);
    return () => {
      if (page) void pickApi.cancelPick(page).catch(() => undefined);
    };
  }, [page]);

  const toggle = () => {
    if (!local) return;
    if (picking) {
      void pickApi.cancelPick(page).catch(() => undefined);
      return;
    }
    setPicking(true);
    setSent(false);
    const asked = page;
    void pickApi
      .pick(asked)
      .then((picked) => {
        if (picked && shownPage.current === asked) setPick(picked);
      })
      .catch((reason) => {
        if (shownPage.current === asked) setError(errorText(reason));
      })
      .finally(() => {
        if (shownPage.current === asked) setPicking(false);
      });
  };

  const send = () => {
    if (!pick) return;
    const chat = useMistyStore.getState();
    chat.setQuery(withElementBlock(chat.query, pick.element));
    setSent(true);
  };

  const clear = () => {
    setPick(null);
    setSent(false);
  };

  return {
    local,
    picking,
    pick,
    sent,
    error,
    toggle,
    send,
    clear,
    dismissError: () => setError(""),
  };
}
