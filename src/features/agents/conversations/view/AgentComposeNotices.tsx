import { Reply, X } from "lucide-react";
import type { GlobalAiConversation } from "../state/conversationTypes";
import { useMistyStore } from "../state/useMistyStore";
import { needsModelKey } from "../../models/ModelKeyNeeded";
import { openModelSettings } from "../../models/modelKeys";
import { IconButton, Surface, Text } from "@/shared/ui";
import { ErrorNotice } from "../ErrorNotice";

/**
 * The conversation's last error as a notice that stays while it holds, with the one way out it
 * has: adding a model key, or reconnecting to a running task the window lost.
 */
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
    <ErrorNotice
      message={error}
      action={
        needsModelKey(error)
          ? { label: "Open Models settings", onSelect: openModelSettings }
          : reconnect
            ? {
                label: "Reconnect to task",
                onSelect: () => void useMistyStore.getState().loadConversations(true),
              }
            : undefined
      }
      onDismiss={dismiss}
    />
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
    <Surface
      tone="none"
      edge="hairline"
      radius="lg"
      className="mb-2 flex items-center gap-2 py-1.5 pr-1.5 pl-3"
    >
      <Text bare tone="muted" className="flex shrink-0">
        <Reply aria-hidden="true" />
      </Text>
      <Text as="p" size="caption" tone="muted" className="m-0 flex-1">
        <Text bare tone="default">
          Replying to {agentName}
        </Text>{" "}
        {reply}
      </Text>
      <IconButton size="sm" label="Cancel reply" onClick={cancel}>
        <X />
      </IconButton>
    </Surface>
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
