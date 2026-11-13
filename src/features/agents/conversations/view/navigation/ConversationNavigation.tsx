import { useMemo, type RefObject } from "react";
import { useShortcutHandler } from "@/features/shortcuts";
import type { GlobalAiMessage } from "../../state/conversationTypes";
import { FindPanel } from "./FindPanel";
import { MessageAnchorRail } from "./MessageAnchorRail";
import { createAnchorsBuilder } from "./timelineAnchors";
import { useAnchorRailScroll } from "./useAnchorRailScroll";
import { useConversationSearch } from "./useConversationSearch";

const EMPTY: GlobalAiMessage[] = [];

/** Ways around a long chat: the rail of the person's messages, search inside the chat, and the
 * shortcuts that jump between messages. */
export function ConversationNavigation({
  conversationId,
  messages = EMPTY,
  scrollRef,
}: {
  conversationId?: string;
  messages?: GlobalAiMessage[];
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const build = useMemo(createAnchorsBuilder, [conversationId]);
  const anchors = useMemo(() => build(messages), [build, messages]);
  const rail = useAnchorRailScroll(scrollRef, anchors);
  const search = useConversationSearch(scrollRef, messages, conversationId);
  const shown = () =>
    Boolean(scrollRef.current?.isConnected && scrollRef.current.getClientRects().length);
  useShortcutHandler("chat.previous_prompt", () => rail.step(-1), shown);
  useShortcutHandler("chat.next_prompt", () => rail.step(1), shown);
  return (
    <>
      <MessageAnchorRail
        activeAnchorId={rail.activeAnchorId}
        anchors={anchors}
        onScrollToAnchor={rail.scrollToAnchor}
      />
      {search.open ? (
        <FindPanel
          inputRef={search.inputRef}
          query={search.query}
          onQueryChange={search.setQuery}
          caseSensitive={search.caseSensitive}
          onCaseSensitiveChange={search.setCaseSensitive}
          wholeWord={search.wholeWord}
          onWholeWordChange={search.setWholeWord}
          useRegex={search.useRegex}
          onUseRegexChange={search.setUseRegex}
          current={search.current}
          total={search.total}
          onPrev={search.previous}
          onNext={search.next}
          onClose={search.close}
        />
      ) : null}
    </>
  );
}
