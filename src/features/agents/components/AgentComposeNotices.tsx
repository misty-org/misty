import { Reply, X } from "lucide-react";
import type { GlobalAiConversation } from "@/features/misty/types";
import { useMistyStore } from "@/features/misty/useMistyStore";
import { ModelKeyNeededButton, needsModelKey } from "@/features/settings/ModelKeyNeeded";
import { Button, IconButton } from "@/shared/ui";

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
  if (!error) return null;
  return (
    <div role="alert" className="agent-compose-error">
      <p>{error}</p>
      {needsModelKey(error) && <ModelKeyNeededButton />}
      {reconnect && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void useMistyStore.getState().loadConversations(true)}
        >
          Reconnect to task
        </Button>
      )}
      <IconButton label="Dismiss error" onClick={dismiss}>
        <X size={16} />
      </IconButton>
    </div>
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
