import { EmptyState, ErrorState, Skeleton, Surface, Text } from "@/shared/ui";
import { ChatMessagesSkeleton } from "./ChatMessagesSkeleton";

/**
 * An open conversation whose chat list hasn't answered yet, or failed to: its title bar and
 * messages in their own shape while it loads.
 */
export function ConversationLoadState(props: {
  error: string;
  onRetry: () => void;
  /** Shown in the side panel, which has no title bar of its own. */
  panel?: boolean;
}) {
  if (!props.error)
    return (
      <Surface tone="page" className="flex h-full min-h-0 flex-col overflow-hidden">
        {props.panel ? null : (
          <div className="flex min-h-12 shrink-0 items-center px-4 py-1.5" aria-hidden="true">
            <Skeleton className="h-3.5 w-32" />
          </div>
        )}
        <ChatMessagesSkeleton framed />
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

/** The open chat's name above its messages; the chat sidebar switches chats. */
export function ChatTitleBar(props: { title: string }) {
  return (
    <Surface
      as="header"
      tone="page"
      className="flex min-h-12 shrink-0 items-center gap-2 px-3 py-1.5"
    >
      <Text as="h1" full tone="bright" className="m-0 min-w-0 flex-1 px-1 text-sm font-medium">
        {props.title}
      </Text>
    </Surface>
  );
}
