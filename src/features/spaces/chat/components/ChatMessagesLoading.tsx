import { PaneLoading, cn } from "@misty/ui";

/**
 * A chat's first messages while they load. Messages vary in length and kind, so their shape isn't
 * known until they arrive: one spinner in the middle of the conversation (`PaneLoading`). `framed`
 * takes the message scroller's place, for where the scroller isn't there yet.
 */
export function ChatMessagesLoading({ framed = false }: { framed?: boolean }) {
  return (
    <div className={cn("flex min-h-0 flex-col", framed ? "flex-1" : "h-full")}>
      <PaneLoading label="Loading conversation" />
    </div>
  );
}
