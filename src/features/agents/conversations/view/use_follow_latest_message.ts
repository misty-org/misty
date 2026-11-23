import { useEffect, type RefObject } from "react";

export function useFollowLatestMessage(
  scrollRef: RefObject<HTMLDivElement | null>,
  messages: readonly unknown[] | undefined,
  working: boolean,
) {
  useEffect(() => {
    const view = scrollRef.current;
    if (messages?.length && view && view.scrollHeight - view.scrollTop - view.clientHeight < 220)
      view.scrollTop = view.scrollHeight;
  }, [scrollRef, messages, working]);
}
