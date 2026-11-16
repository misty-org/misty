import { Surface, Text } from "@/shared/ui";

export function ChatReadOnlyNotice() {
  return (
    <Surface
      tone="card"
      radius="lg"
      className="mx-[clamp(1rem,4vw,3.5rem)] mb-4 shrink-0 px-4 py-3 text-center"
      role="status"
    >
      <Text tone="muted" wrap className="text-sm">
        You can read this conversation, but you cannot send messages.
      </Text>
    </Surface>
  );
}
