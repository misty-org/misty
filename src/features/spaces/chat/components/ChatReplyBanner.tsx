import { cn, IconButton } from "@/shared/ui";
import { X } from "lucide-react";

export function ChatReplyBanner({
  senderName,
  onCancel,
}: {
  senderName: string;
  onCancel: () => void;
}) {
  return (
    <div
      className={cn(
        "mx-3 mt-3 flex items-center justify-between rounded-md border-l-2 border-charcoal-active",
        "bg-charcoal-card px-3 py-1.5 text-xs text-cream-muted",
      )}
    >
      <span>Replying to {senderName}</span>
      <IconButton size="sm" label="Cancel reply" onClick={onCancel}>
        <X />
      </IconButton>
    </div>
  );
}
