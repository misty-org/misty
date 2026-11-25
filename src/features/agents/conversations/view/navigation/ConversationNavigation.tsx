import type { RefObject } from "react";
import { FindBar } from "@misty/ui";
import type { GlobalAiMessage } from "../../state/conversation_types";
import { useConversationSearch } from "./use_conversation_search";

const EMPTY: GlobalAiMessage[] = [];

export function ConversationNavigation({
  conversationId,
  messages = EMPTY,
  scrollRef,
}: {
  conversationId?: string;
  messages?: GlobalAiMessage[];
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const search = useConversationSearch(scrollRef, messages, conversationId);
  return (
    <>
      {search.open ? (
        <div className="contents">
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
