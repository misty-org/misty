import { InputGroupButton } from "@/shared/ui";
import { X } from "lucide-react";

export function ChatReplyBanner({
  senderName,
  onCancel,
}: {
  senderName: string;
  onCancel: () => void;
}) {
  return (
    <div className="mx-3 mt-3 flex items-center justify-between rounded-md border-l-2 border-charcoal-active bg-charcoal-card px-3 py-1.5 text-xs text-cream-muted">
      <span>Replying to {senderName}</span>
      <InputGroupButton
        variant="ghost"
        size="icon-xs"
        type="button"
        onClick={onCancel}
        aria-label="Cancel reply"
      >
        <X />
      </InputGroupButton>
    </div>
  );
}
