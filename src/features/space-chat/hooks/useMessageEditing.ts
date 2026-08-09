import { spansToText } from "@/features/space-connections";
import type { SpaceMessage } from "@/services/spaces/dto/interfaces/types";
import { useState } from "react";

/**
 * Inline edit state for one message at a time.
 *
 * Cancelling returns focus to the message's action button, because the edit
 * form is what had focus and removing it would otherwise drop the user at the
 * top of the document.
 */
export function useMessageEditing() {
  const [editingMessageId, setEditingMessageId] = useState("");
  const [editingText, setEditingText] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const begin = (message: SpaceMessage) => {
    setEditingMessageId(message.id);
    setEditingText(spansToText(message.content));
  };

  const cancel = (messageId: string) => {
    setEditingMessageId("");
    setEditingText("");
    window.setTimeout(() => {
      document
        .querySelector<HTMLButtonElement>(
          `#message-${CSS.escape(messageId)} button[aria-label="Message actions"]`,
        )
        ?.focus();
    }, 0);
  };

  const reset = () => {
    setEditingMessageId("");
    setEditingText("");
  };

  return {
    editingMessageId,
    editingText,
    setEditingText,
    editSaving,
    setEditSaving,
    begin,
    cancel,
    reset,
  };
}

export type MessageEditingState = ReturnType<typeof useMessageEditing>;
