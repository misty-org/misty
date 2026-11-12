import { EmptyState, ErrorState, LoadingScreen, OverflowFadeText } from "@/shared/ui";

/** An open conversation that is still loading, or failed to. */
export function ConversationLoadState(props: { error: string; onRetry: () => void }) {
  if (!props.error)
    return <LoadingScreen className="h-full bg-charcoal-bg" label="Opening conversation" />;
  return (
    <div className="h-full bg-charcoal-bg">
      <ErrorState
        title="Conversation couldn’t load"
        line={props.error}
        action={{ label: "Try again", onClick: props.onRetry, variant: "secondary" }}
      />
    </div>
  );
}

/** A conversation the person can no longer open. */
export function ConversationUnavailable(props: { onBack: () => void }) {
  return (
    <div className="h-full bg-charcoal-bg">
      <EmptyState
        title="Conversation isn’t available"
        line="Choose another conversation from Chat."
        action={{ label: "Back to Chat", onClick: props.onBack, variant: "secondary" }}
      />
    </div>
  );
}

/** The open chat's name above its messages; the chat sidebar switches chats. */
export function ChatTitleBar(props: { title: string }) {
  return (
    <header className="flex min-h-12 shrink-0 items-center gap-2 bg-charcoal-bg px-3 py-1.5">
      <OverflowFadeText
        as="h1"
        full
        className="m-0 min-w-0 flex-1 px-1 text-sm font-medium text-cream-bright"
      >
        {props.title}
      </OverflowFadeText>
    </header>
  );
}
