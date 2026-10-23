import { Button, EmptyState, ErrorState, LoadingState } from "@/shared/ui";

/** An open conversation that is still loading, or failed to. */
export function ConversationLoadState(props: { error: string; onRetry: () => void }) {
  if (!props.error)
    return (
      <LoadingState
        className="h-full bg-charcoal-bg"
        label="Opening conversation"
        title="Opening conversation"
      />
    );
  return (
    <ErrorState
      className="h-full bg-charcoal-bg"
      title="Conversation couldn’t load"
      description={props.error}
      action={
        <Button type="button" variant="outline" onClick={props.onRetry}>
          Try again
        </Button>
      }
    />
  );
}

/** A conversation the person can no longer open. */
export function ConversationUnavailable(props: { onBack: () => void }) {
  return (
    <EmptyState
      className="h-full bg-charcoal-bg"
      title="Conversation isn’t available"
      description="Choose another conversation from Chat."
      action={
        <Button type="button" variant="outline" onClick={props.onBack}>
          Back to Chat
        </Button>
      }
    />
  );
}

/** The open chat's name above its messages; the chat sidebar switches chats. */
export function ChatTitleBar(props: { title: string }) {
  return (
    <header className="flex min-h-11 shrink-0 items-center gap-2 bg-charcoal-bg px-3 py-1.5">
      <h1 className="m-0 min-w-0 flex-1 truncate px-1 text-sm font-medium text-cream-bright">
        {props.title}
      </h1>
    </header>
  );
}
