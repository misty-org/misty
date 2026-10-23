import { spacesApi } from "@/api/spaces/api";
import type { SpaceMessage } from "@/api/spaces/dto/entities";
import { useEffect, useRef } from "react";

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
    const last = messages[messages.length - 1];
    if (!last) return;
    const receiptKey = `${spaceId}:${conversationId || "everyone"}:${last.seq}`;
    if (lastReadReceiptRef.current === receiptKey) return;
    lastReadReceiptRef.current = receiptKey;
    const request = conversationId
      ? spacesApi.markConversationRead(spaceId, conversationId, last.seq)
      : markSpaceRead(spaceId, last.seq);
    void request.catch(() => {
      if (lastReadReceiptRef.current === receiptKey) lastReadReceiptRef.current = "";
    });
  }, [enabled, conversationId, markSpaceRead, messages, spaceId]);
}
