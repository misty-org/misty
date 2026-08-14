import { useState } from "react";

const idle = { dirty: false, busy: false };

/**
 * Holds back navigation while the agent editor or conversation is busy, and asks before a
 * change would discard unsaved edits or an unsent message.
 */
export function useAgentChangeGuard(working: boolean) {
  const [editorStatus, setEditorStatus] = useState(idle);
  const [conversationStatus, setConversationStatus] = useState(idle);
  const [pendingChange, setPendingChange] = useState<() => void>();
  const change = (action: () => void, replacesConversation = true) => {
    if (
      pendingChange ||
      editorStatus.busy ||
      (replacesConversation && (conversationStatus.busy || working))
    )
      return;
    if (editorStatus.dirty || (replacesConversation && conversationStatus.dirty)) {
      setPendingChange(() => action);
    } else action();
  };
  return {
    change,
    busy: editorStatus.busy || conversationStatus.busy,
    pending: Boolean(pendingChange),
    setEditorStatus,
    setConversationStatus,
    cancel: () => setPendingChange(undefined),
    discard: () => {
      pendingChange?.();
      setPendingChange(undefined);
      setEditorStatus(idle);
    },
  };
}
