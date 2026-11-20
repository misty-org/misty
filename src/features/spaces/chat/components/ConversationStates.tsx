import { EmptyState, ErrorState, Surface } from "@misty/ui";
import { ChatMessagesLoading } from "./ChatMessagesLoading";

/**
 * An open conversation whose chat list hasn't answered yet, or failed to: its messages in their
 * own shape while it loads.
 */
export function ConversationLoadState(props: {
  error: string;
  onRetry: () => void;
}) {
  if (!props.error)
    return (
      <Surface tone="page" className="flex h-full min-h-0 flex-col overflow-hidden">
        <ChatMessagesLoading framed />
      </Surface>
    );
  return (
    <Surface tone="page" className="h-full">
      <ErrorState
        title="Conversation couldn’t load"
        line={props.error}
        action={{ label: "Try again", onClick: props.onRetry, variant: "secondary" }}
      />
    </Surface>
  );
}

/** A conversation the person can no longer open. */
export function ConversationUnavailable(props: { onBack: () => void }) {
  return (
    <Surface tone="page" className="h-full">
      <EmptyState
        title="Conversation isn’t available"
        line="Choose another conversation from Chat."
        action={{ label: "Back to chat", onClick: props.onBack, variant: "secondary" }}
      />
    </Surface>
  );
}
