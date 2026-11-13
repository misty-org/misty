import { spacesApi } from "../../api/api";
import type { SpaceMessage } from "../../api/dto/entities";
import { useEffect, useRef } from "react";
import { markSpaceChatReadLocally, spaceChatReadSaved } from "../spaceConversationsResource";

/** Marks the open chat read up to its newest message, once per message. */
export function useChatReadReceipts(options: {
  spaceId: string;
  conversationId: string;
  enabled: boolean;
  messages: SpaceMessage[];
  markSpaceRead: (spaceId: string, seq: number) => Promise<void>;
}) {
  const { spaceId, conversationId, enabled, messages, markSpaceRead } = options;
  const lastReadReceiptRef = useRef("");
  useEffect(() => {
    if (!enabled) return;
    // The newest message the server has: one still being sent carries a made-up seq.
    const last = [...messages].reverse().find((message) => !message.local_delivery_state);
    if (!last) return;
    const receiptKey = `${spaceId}:${conversationId || "everyone"}:${last.seq}`;
    if (lastReadReceiptRef.current === receiptKey) return;
    lastReadReceiptRef.current = receiptKey;
    // The chat's unread mark in the sidebar goes now, not when the server answers.
    markSpaceChatReadLocally(spaceId, conversationId);
    const request = conversationId
      ? spacesApi.markConversationRead(spaceId, conversationId, last.seq)
      : markSpaceRead(spaceId, last.seq);
    void request.then(
      () => spaceChatReadSaved(spaceId, conversationId),
      () => {
        if (lastReadReceiptRef.current === receiptKey) lastReadReceiptRef.current = "";
      },
    );
  }, [enabled, conversationId, markSpaceRead, messages, spaceId]);
}
