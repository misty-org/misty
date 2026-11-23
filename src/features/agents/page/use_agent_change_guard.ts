import { useCallback, useRef, useState } from "react";

const idle = { dirty: false, busy: false };

export function useAgentChangeGuard() {
  const [editorStatus, setEditorStatus] = useState(idle);
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
