import { AppRequestCard, type AppRequest } from "@/features/agents";
import { continueAfterAppRequest } from "./appRequests";
import { useMistyStore } from "./useMistyStore";

/** An app card in a Misty conversation that continues it once answered. */
export function MistyAppRequestCard({
  messageId,
  request,
}: {
  messageId: string;
  request: AppRequest;
}) {
  const conversationId = useMistyStore(
    (state) =>
      state.conversations.find((conversation) =>
        conversation.messages.some((message) => message.id === messageId),
      )?.id,
  );
  return (
    <AppRequestCard
      request={request}
      onResolved={(next) => {
        if (conversationId)
          void continueAfterAppRequest(
            useMistyStore.setState,
            useMistyStore.getState,
            conversationId,
            messageId,
            next,
          );
      }}
    />
  );
}
