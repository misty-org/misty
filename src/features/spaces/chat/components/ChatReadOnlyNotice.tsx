export function ChatReadOnlyNotice() {
  return (
    <div
      className="mx-[clamp(16px,4vw,56px)] mb-4 shrink-0 rounded-lg bg-charcoal-card px-4 py-3 text-center text-sm text-cream-muted"
      role="status"
    >
      You can read this conversation, but you cannot send messages.
    </div>
  );
}
