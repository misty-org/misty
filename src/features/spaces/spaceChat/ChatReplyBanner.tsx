import { X } from "lucide-react";
import { InputGroupButton } from "@/ui";

export function ChatReplyBanner({
  senderName,
  onCancel,
}: {
  senderName: string;
  onCancel: () => void;
}) {
  return (
    <div className="mx-3 mt-3 flex items-center justify-between rounded-md border-l-2 border-primary bg-muted px-3 py-1.5 text-xs text-muted-foreground">
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
