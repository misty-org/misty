import { useMemo, type RefObject } from "react";
import { useShortcutHandler } from "@/features/shortcuts";
import { FindBar } from "@/shared/ui";
import type { GlobalAiMessage } from "../../state/conversationTypes";
import { MessageAnchorRail } from "./MessageAnchorRail";
import { createAnchorsBuilder } from "./timelineAnchors";
import { useAnchorRailScroll } from "./useAnchorRailScroll";
import { useConversationSearch } from "./useConversationSearch";

const EMPTY: GlobalAiMessage[] = [];
/** The find bar sits under the chat's title, which the transcript scrolls beneath. */

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
        // The shared find bar, floating below the chat's see-through title, since the transcript
        // scrolls under it.
        <div className="contents [--find-bar-inset:var(--agent-conversation-inset,0px)]">
          <FindBar
            floating
            label="Find in chat"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              search.close();
            }}
            find={{
              value: search.query,
              onChange: search.setQuery,
              inputRef: search.inputRef,
              onKeyDown: (event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (event.shiftKey) search.previous();
                else search.next();
              },
            }}
            caseSensitive={search.caseSensitive}
            onCaseSensitive={() => search.setCaseSensitive(!search.caseSensitive)}
            wholeWord={search.wholeWord}
            onWholeWord={() => search.setWholeWord(!search.wholeWord)}
            regex={search.useRegex}
            onRegex={() => search.setUseRegex(!search.useRegex)}
            count={
              search.query && search.total > 0
                ? `${search.current}/${search.total}`
                : search.query
                  ? "No results"
                  : ""
            }
            empty={Boolean(search.query) && search.total === 0}
            canStep={search.total > 0}
            onPrevious={search.previous}
            onNext={search.next}
            onClose={search.close}
          />
        </div>
      ) : null}
    </>
  );
}
