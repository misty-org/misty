import { useCallback, useRef, useState } from "react";

const idle = { dirty: false, busy: false };

/**
 * Holds back navigation while the agent editor or the composer is busy (recording, uploading),
 * and asks before a change would discard unsaved edits or an unsent message. A running agent
 * does not hold it: runs keep working in their own chats while the person moves between them
 * (docs/agents/browser.md).
 */
export function useAgentChangeGuard() {
  const [editorStatus, setEditorStatus] = useState(idle);
  // Whether the draft is dirty matters only when a change is attempted. Keeping it out
  // of state spares the whole Agents page a render on the first keystroke of a message.
  const conversationDirty = useRef(false);
  const [conversationBusy, setConversationBusy] = useState(false);
  const setConversationStatus = useCallback((status: { dirty: boolean; busy: boolean }) => {
    conversationDirty.current = status.dirty;
    setConversationBusy(status.busy);
  }, []);
  const [pendingChange, setPendingChange] = useState<() => void>();
  const change = (action: () => void, replacesConversation = true) => {
    if (pendingChange || editorStatus.busy || (replacesConversation && conversationBusy)) return;
    if (editorStatus.dirty || (replacesConversation && conversationDirty.current)) {
      setPendingChange(() => action);
    } else action();
  };
  return {
    change,
    busy: editorStatus.busy || conversationBusy,
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
