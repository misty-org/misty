import { AssistantSessionSidebar } from "@/pages/Assistant/desktop/AssistantSessionSidebar";
import { spaceMikaScopeKey, useMikaSessionStore } from "@/stores/assistant/useMikaSessionStore";

export function SpaceAssistantSessionSidebar({
  accountId,
  spaceId,
  accessReady,
}: {
  accountId: string;
  spaceId: string;
  accessReady: boolean;
}) {
  const conversationScopeKey = useMikaSessionStore((state) => state.conversationScopeKey);
  const scopeReady = conversationScopeKey === spaceMikaScopeKey(accountId, spaceId);

  if (!accessReady || !scopeReady) return <SpaceAssistantSessionLoading />;
  return <AssistantSessionSidebar embedded />;
}

function SpaceAssistantSessionLoading() {
  return (
    <section
      className="flex h-full min-h-0 flex-col gap-3"
      aria-label="Mika sessions"
      aria-busy="true"
    >
      <span className="h-9 w-full animate-pulse rounded-md bg-muted" />
      <span className="mx-2 mt-1 h-3 w-16 animate-pulse rounded bg-muted" />
      <span className="h-8 w-full animate-pulse rounded-md bg-muted" />
    </section>
  );
}
