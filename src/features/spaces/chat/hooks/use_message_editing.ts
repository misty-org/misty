import { spansToText } from "../components/message_text";
import type { SpaceMessage } from "../../api/dto/entities";
import { useCallback, useState } from "react";

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

  const reset = useCallback(() => {
    setEditingMessageId("");
    setEditingText("");
  }, []);

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
