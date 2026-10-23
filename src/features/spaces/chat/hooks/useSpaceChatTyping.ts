import type { SpaceMember } from "@/api/spaces/dto/entities";
import { useSpacesStore } from "../../store/useSpacesStore";
import { spaceTypingScopeKey } from "../../store/realtimeTypes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const typingTimeoutMs = 1_800;
const typingRefreshMs = 1_000;
const emptyTypingByUser: Record<string, number> = {};

/** Sends ephemeral typing events and names people typing in this conversation. */
export function useSpaceChatTyping(options: {
  spaceId: string;
  conversationId: string;
  currentUserId?: string;
  members: SpaceMember[];
}) {
  const { spaceId, conversationId, currentUserId, members } = options;
  const sendTyping = useSpacesStore((state) => state.sendTyping);
  const scopeKey = spaceTypingScopeKey(spaceId, conversationId);
  const typingByUser = useSpacesStore(
    (state) => state.typingByConversation[scopeKey] ?? emptyTypingByUser,
  );
  const [now, setNow] = useState(Date.now());
  const active = useRef(false);
  const lastSentAt = useRef(0);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
    if (!active.current) return;
    active.current = false;
    sendTyping(spaceId, conversationId, false);
  }, [conversationId, sendTyping, spaceId]);

  const onTextInput = useCallback(
    (text: string) => {
      if (!text.trim()) {
        stop();
        return;
      }
      const timestamp = Date.now();
      if (!active.current || timestamp - lastSentAt.current >= typingRefreshMs) {
        active.current = true;
        lastSentAt.current = timestamp;
        sendTyping(spaceId, conversationId, true);
      }
      if (stopTimer.current) clearTimeout(stopTimer.current);
      stopTimer.current = setTimeout(stop, typingTimeoutMs);
    },
    [conversationId, sendTyping, spaceId, stop],
  );

  useEffect(() => stop, [stop]);

  useEffect(() => {
    const expiries = Object.values(typingByUser).filter((expiresAt) => expiresAt > Date.now());
    if (expiries.length === 0) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(...expiries) - Date.now() + 10);
    return () => clearTimeout(timer);
  }, [typingByUser]);

  const label = useMemo(() => {
    const names = Object.entries(typingByUser)
      .filter(([userId, expiresAt]) => userId !== currentUserId && expiresAt > now)
      .map(([userId]) => members.find((member) => member.user_id === userId)?.name)
      .filter((name): name is string => Boolean(name));
    if (names.length === 0) return "";
    if (names.length === 1) return `${names[0]} is typing…`;
    if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
    return `${names[0]}, ${names[1]} and ${names.length - 2} others are typing…`;
  }, [currentUserId, members, now, typingByUser]);

  return { label, onTextInput, stop };
}
