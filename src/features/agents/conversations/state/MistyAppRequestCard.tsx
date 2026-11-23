import { AppRequestCard } from "../../connected-apps/AppRequestCard";
import { type AppRequest } from "../../connected-apps/api";
import { continueAfterAppRequest } from "./app_requests";
import { useMistyStore } from "./use_misty_store";

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
