import { Reply, X } from "lucide-react";
import type { GlobalAiConversation } from "../state/conversation_types";
import { useMistyStore } from "../state/use_misty_store";
import { needsDefaultEngine, openEngineSettings } from "../../engines/engine_needed";
import { IconButton, Surface, Text } from "@misty/ui";
import { ErrorNotice } from "../ErrorNotice";

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
        needsDefaultEngine(error)
          ? { label: "Open engine settings", onSelect: openEngineSettings }
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
    <Surface tone="faint" radius="xl" className="mb-2 flex items-center gap-2 py-1.5 pr-1.5 pl-3">
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

export const conversationInvocationIds = (
  conversation: GlobalAiConversation | undefined,
  starting: string | undefined,
) => [
  ...(conversation?.messages.flatMap((message) =>
    message.invocationId ? [message.invocationId] : [],
  ) ?? []),
  ...(starting ? [starting] : []),
];
