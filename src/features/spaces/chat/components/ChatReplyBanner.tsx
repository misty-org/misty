import { IconButton, Surface, Text } from "@/shared/ui";
import { X } from "lucide-react";

export function ChatReplyBanner({
  senderName,
  onCancel,
}: {
  senderName: string;
  onCancel: () => void;
}) {
  return (
    <Surface
      tone="card"
      edge="strong"
      radius="md"
      className="mx-3 mt-3 flex items-center justify-between border-0 border-l-2 px-3 py-1.5 text-xs"
    >
      <Text tone="muted">Replying to {senderName}</Text>
      <IconButton size="sm" label="Cancel reply" onClick={onCancel}>
        <X />
      </IconButton>
    </Surface>
  );
}
