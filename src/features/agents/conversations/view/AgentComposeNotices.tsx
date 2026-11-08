import { Reply, X } from "lucide-react";
import type { GlobalAiConversation } from "../state/conversationTypes";
import { useMistyStore } from "../state/useMistyStore";
import { ModelKeyNeededButton, needsModelKey } from "../../models/ModelKeyNeeded";
import { Button, ErrorNotification, IconButton } from "@/shared/ui";

/** The conversation's last error above the composer; a lost running task can reconnect. */
export function AgentComposeError({
  error,
  reconnect,
  dismiss,
}: {
  error: string | null;
  reconnect: boolean;
  dismiss: () => void;
}) {
  return (
    <ErrorNotification message={error} onDismiss={dismiss}>
      {needsModelKey(error ?? "") && <ModelKeyNeededButton />}
      {reconnect && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void useMistyStore.getState().loadConversations(true)}
        >
          Reconnect to task
        </Button>
      )}
    </ErrorNotification>
  );
}

/** The answer, or part of one, the next message replies to. */
export function AgentReplyTarget({
  agentName,
  reply,
  cancel,
}: {
  agentName: string;
  reply: string;
  cancel: () => void;
}) {
  if (!reply) return null;
  return (
    <div className="agent-reply-target">
      <Reply size={14} aria-hidden="true" />
      <p>
        <span>Replying to {agentName}</span> {reply}
      </p>
      <IconButton size="xs" label="Cancel reply" onClick={cancel}>
        <X />
      </IconButton>
    </div>
  );
}

/** Every run in the conversation, and the one starting in it now. */
export const conversationInvocationIds = (
  conversation: GlobalAiConversation | undefined,
  starting: string | undefined,
) => [
  ...(conversation?.messages.flatMap((message) =>
    message.invocationId ? [message.invocationId] : [],
  ) ?? []),
  ...(starting ? [starting] : []),
];
