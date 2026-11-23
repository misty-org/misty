import { useEffect, useState } from "react";

export function useJumpToMessage(options: {
  spaceId: string;
  conversationId: string;
  linked: string;
  loaded: (id: string) => boolean;
  historyReady: boolean;
  history: string;
  loadOlder: () => void;
}) {
  const { spaceId, conversationId, linked, historyReady, history, loadOlder } = options;
  const [jumpTargetId, setJumpTargetId] = useState("");
  useEffect(() => setJumpTargetId(""), [spaceId, conversationId]);
  const targetMessageId = jumpTargetId || linked;
  const targetLoaded = Boolean(targetMessageId && options.loaded(targetMessageId));
  useEffect(() => {
    if (!targetMessageId || !historyReady) return;
    if (targetLoaded) {
      if (jumpTargetId) setJumpTargetId("");
      return;
    }
    if (history === "complete") {
      if (jumpTargetId) setJumpTargetId("");
      return;
    }
    if (history === "more") loadOlder();
  }, [history, historyReady, jumpTargetId, loadOlder, targetLoaded, targetMessageId]);
  return { targetMessageId, setJumpTargetId };
}
