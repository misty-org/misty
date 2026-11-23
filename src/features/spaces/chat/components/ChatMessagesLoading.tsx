import { PaneLoading, cn } from "@misty/ui";

export function ChatMessagesLoading({ framed = false }: { framed?: boolean }) {
  return (
    <div className={cn("flex min-h-0 flex-col", framed ? "flex-1" : "h-full")}>
      <PaneLoading label="Loading conversation" />
    </div>
  );
}
