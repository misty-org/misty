export function ChatReadOnlyNotice() {
  return (
    <div
      className="mx-[clamp(16px,4vw,56px)] mb-4 shrink-0 rounded-lg bg-muted/40 px-4 py-3 text-center text-sm text-muted-foreground"
      role="status"
    >
      You can read this conversation, but you cannot send messages.
    </div>
  );
}
