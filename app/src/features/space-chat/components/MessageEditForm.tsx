import type { SpaceMessage } from "@/services/spaces/dto/interfaces/types";
import { Button, Textarea } from "@/shared/ui";
import type { FormEvent } from "react";

export function MessageEditForm({
  message,
  text,
  saving,
  onText,
  onCancel,
  onSubmit,
}: {
  message: SpaceMessage;
  text: string;
  saving: boolean;
  onText: (value: string) => void;
  onCancel: (messageId: string) => void;
  onSubmit: (event: FormEvent, message: SpaceMessage) => void;
}) {
  return (
    <form
      className="mt-1 rounded-lg bg-charcoal-card p-2"
      onSubmit={(event) => onSubmit(event, message)}
    >
      <Textarea
        autoFocus
        className="min-h-20 resize-y border-0 bg-transparent shadow-none focus-visible:ring-0"
        maxLength={4000}
        value={text}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !saving) onCancel(message.id);
        }}
        aria-label="Edit message"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          disabled={saving}
          onClick={() => onCancel(message.id)}
        >
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={saving || !text.trim()}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
