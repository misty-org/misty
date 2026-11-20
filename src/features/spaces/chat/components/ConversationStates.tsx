import { EmptyState, ErrorState, PageHeader, Skeleton, Surface } from "@misty/ui";
import { SpaceCrumb } from "../../components/space-row/SpaceCrumb";
import { ChatMessagesSkeleton } from "./ChatMessagesSkeleton";

/**
 * An open conversation whose chat list hasn't answered yet, or failed to: its title bar and
 * messages in their own shape while it loads.
 */
export function ConversationLoadState(props: {
  error: string;
  onRetry: () => void;
  /** Drawn under a bar that is already there (the chat page's), or in the side panel, which has
   *  none: the messages' shape alone. */
  bare?: boolean;
}) {
  if (!props.error)
    return (
      <Surface tone="page" className="flex h-full min-h-0 flex-col overflow-hidden">
        {props.bare ? null : (
          <PageHeader title={<Skeleton className="h-4 w-32" aria-hidden="true" />} />
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

/**
 * The bar every Space page wears, over the open chat: the Space, then the chat's name. The chat
 * sidebar switches chats.
 */
export function ChatTitleBar(props: { spaceId: string; title: string }) {
  return <PageHeader title={<SpaceCrumb spaceId={props.spaceId} here={props.title} />} />;
}
